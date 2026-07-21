import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";

import {
  type RunCreateRequest,
  wsCommandSchema,
  wsRpcResponseSchema,
} from "@lovart.dofe/shared";
import type { ContentBlock, ToolBlock } from "@lovart.dofe/shared";
import type { AgentRunService } from "../agent/runtime.js";
import type {
  AuthenticatedUser,
  RequestAuthenticator,
} from "../auth/sso-authenticator.js";
import type { AgentRunMetadataService } from "../features/agent-runs/agent-run-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { ChatService } from "../features/chat/chat-service.js";
import type { ThreadService } from "../features/chat/thread-service.js";
import type { SettingsService } from "../features/settings/settings-service.js";
import {
  parseWebSocketAuthRequest,
  selectWebSocketAuthProtocol,
} from "./auth-protocol.js";
import type { ConnectionManager } from "./connection-manager.js";
import type { CanvasEventBuffer } from "./event-buffer.js";
import { createPipelineLogger } from "./logger.js";

export { selectWebSocketAuthProtocol } from "./auth-protocol.js";

type RegisterWsOptions = {
  agentRuns: AgentRunService;
  agentRunMetadataService?: AgentRunMetadataService;
  auth?: RequestAuthenticator;
  chatService?: ChatService;
  connectionManager: ConnectionManager;
  eventBuffer?: CanvasEventBuffer;
  settingsService?: SettingsService;
  threadService?: ThreadService;
  viewerService?: ViewerService;
};

export async function registerWsRoute(
  app: FastifyInstance,
  options: RegisterWsOptions,
) {
  const { agentRuns, connectionManager } = options;

  app.get(
    "/api/ws",
    { websocket: true },
    (socket: WebSocket, request: FastifyRequest) => {
      const credentials = parseWebSocketAuthRequest(
        request.url,
        request.headers["sec-websocket-protocol"],
      );

      const authenticator = options.auth;
      if (!credentials || !authenticator) {
        request.log.warn(
          { failureCategory: "invalid_websocket_auth" },
          "websocket_connection_rejected",
        );
        socket.close(4001, "Unauthorized");
        return;
      }

      void authenticateAndBind(
        socket,
        credentials.accessToken,
        credentials.connectionId,
        authenticator,
        options,
        agentRuns,
        connectionManager,
      );
    },
  );
}

async function authenticateAndBind(
  socket: WebSocket,
  token: string,
  connectionId: string,
  authenticator: RequestAuthenticator,
  options: RegisterWsOptions,
  agentRuns: AgentRunService,
  connectionManager: ConnectionManager,
) {
  const log = createPipelineLogger("ws");

  let authenticatedUser: AuthenticatedUser;
  try {
    const fakeRequest = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as FastifyRequest;
    const user = await authenticator.authenticate(fakeRequest);
    if (!user) {
      log.warn("auth_rejected", { reason: "invalid_token" });
      socket.close(4001, "Unauthorized");
      return;
    }
    authenticatedUser = user;
    log.info("connected");
  } catch {
    log.warn("auth_error", { failureCategory: "websocket_auth_error" });
    socket.close(4001, "Unauthorized");
    return;
  }

  if (socket.readyState !== 1) return;

  connectionManager.register(connectionId, authenticatedUser.id, socket);

  // Heartbeat with pong timeout (spec §1.3: 60s no-pong → disconnect)
  let lastPong = Date.now();
  socket.on("pong", () => {
    lastPong = Date.now();
  });

  const pingInterval = setInterval(() => {
    if (Date.now() - lastPong > 60_000) {
      log.warn("pong_timeout");
      socket.terminate();
      return;
    }
    if (socket.readyState === 1) {
      socket.ping();
    }
  }, 30_000);

  socket.on("message", (raw: Buffer | string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        typeof raw === "string" ? raw : raw.toString("utf-8"),
      );
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    const obj = parsed as Record<string, unknown>;

    if (obj.type === "rpc.response") {
      try {
        const rpcResponse = wsRpcResponseSchema.parse(parsed);
        connectionManager.handleRpcResponse(connectionId, {
          type: rpcResponse.type,
          id: rpcResponse.id,
          ...(rpcResponse.result !== undefined
            ? { result: rpcResponse.result }
            : {}),
          ...(rpcResponse.error !== undefined
            ? { error: rpcResponse.error }
            : {}),
        });
      } catch {
        // Ignore malformed RPC responses
      }
      return;
    }

    if (obj.type === "command") {
      let msg: ReturnType<typeof wsCommandSchema.parse>;
      try {
        msg = wsCommandSchema.parse(parsed);
      } catch {
        socket.send(
          JSON.stringify({ type: "error", message: "Invalid command format" }),
        );
        return;
      }

      if (msg.action === "agent.run") {
        const p = msg.payload;
        // The authenticated handshake is the sole credential authority. A
        // message payload must not replace it with a token from another user.
        const runToken = token;
        void handleRunCommand(
          {
            ...authenticatedUser,
            accessToken: runToken,
          },
          connectionId,
          {
            sessionId: p.sessionId,
            conversationId: p.conversationId,
            prompt: p.prompt,
            ...(p.canvasId !== undefined ? { canvasId: p.canvasId } : {}),
            ...(p.attachments !== undefined
              ? { attachments: p.attachments }
              : {}),
            ...(p.imageGenerationPreference !== undefined
              ? { imageGenerationPreference: p.imageGenerationPreference }
              : {}),
            ...(p.videoGenerationPreference !== undefined
              ? { videoGenerationPreference: p.videoGenerationPreference }
              : {}),
            ...(p.mentions !== undefined ? { mentions: p.mentions } : {}),
            ...(p.model !== undefined ? { model: p.model } : {}),
          },
          agentRuns,
          connectionManager,
          options,
        );
      } else if (msg.action === "agent.cancel") {
        log.info("run_cancel");
        const cancelResult = agentRuns.cancelRun(msg.payload.runId);
        if (!cancelResult) {
          socket.send(
            JSON.stringify({
              type: "error",
              message: `Run not found: ${msg.payload.runId}`,
            }),
          );
        }
      } else if (msg.action === "canvas.resume") {
        const p = msg.payload;
        log.info("canvas_resume", { lastSeq: p.lastSeq });

        // Re-bind this connection to the canvas
        connectionManager.bindCanvas(connectionId, p.canvasId);

        const missed =
          options.eventBuffer?.getAfter(p.canvasId, p.lastSeq) ?? [];
        const activeRun = connectionManager.getActiveRun(p.canvasId);

        // IMPORTANT: Send ACK FIRST so client registers event listener
        // BEFORE replay events arrive. Otherwise replayed events have no handler.
        connectionManager.sendTo(connectionId, {
          type: "command.ack",
          action: "canvas.resume",
          payload: {
            canvasId: p.canvasId,
            latestSeq: options.eventBuffer?.getLatestSeq(p.canvasId) ?? 0,
            activeRunId: activeRun?.runId ?? null,
            replayed: missed.length,
          },
        });

        // THEN replay missed events from buffer
        for (const entry of missed) {
          connectionManager.sendTo(connectionId, {
            type: "event",
            event: entry.event,
          });
        }
      }
    }
  });

  socket.on("close", () => {
    log.info("disconnected");
    clearInterval(pingInterval);
    connectionManager.remove(connectionId);
  });

  socket.on("error", () => {
    log.error("socket_error");
    clearInterval(pingInterval);
    connectionManager.remove(connectionId);
  });
}

async function handleRunCommand(
  authenticatedUser: AuthenticatedUser,
  connectionId: string,
  payload: Omit<RunCreateRequest, "accessToken">,
  agentRuns: AgentRunService,
  connectionManager: ConnectionManager,
  services: RegisterWsOptions,
) {
  const log = createPipelineLogger("agent.run");
  log.info("started");

  // Resolve thread + model in parallel
  const [threadId, model] = await Promise.all([
    (async (): Promise<string | undefined> => {
      if (!services.threadService) return undefined;
      try {
        const sessionThread =
          await services.threadService.resolveOwnedSessionThread(
            authenticatedUser,
            payload.sessionId,
          );
        return sessionThread.threadId;
      } catch {
        log.warn("thread_resolve_failed", {
          failureCategory: "thread_resolution",
        });
        return undefined;
      }
    })(),
    (async (): Promise<string | undefined> => {
      if (!services.settingsService || !services.viewerService)
        return undefined;
      try {
        const viewer =
          await services.viewerService.ensureViewer(authenticatedUser);
        const settings = await services.settingsService.getWorkspaceSettings(
          authenticatedUser,
          viewer.workspace.id,
        );
        return settings.defaultModel;
      } catch {
        log.warn("model_resolve_failed", {
          failureCategory: "model_resolution",
        });
        return undefined;
      }
    })(),
  ]);
  // Client-provided model takes priority over workspace default
  const resolvedModel = payload.model ?? model;
  log.lap("resolve", { threadId: !!threadId, model: resolvedModel });

  const response = agentRuns.createRun(payload, {
    accessToken: authenticatedUser.accessToken,
    userId: authenticatedUser.id,
    ...(resolvedModel ? { model: resolvedModel } : {}),
    ...(threadId ? { threadId } : {}),
  });
  const runId = response.runId;
  log.lap("run_created");

  // Persist run metadata
  if (threadId && services.agentRunMetadataService) {
    try {
      await services.agentRunMetadataService.createAcceptedRun({
        ...(resolvedModel ? { model: resolvedModel } : {}),
        runId,
        sessionId: payload.sessionId,
        threadId,
      });
    } catch {
      // Non-fatal
    }
  }

  // Bind this connection to the canvas so events route correctly
  const canvasId = payload.canvasId ?? payload.conversationId;
  connectionManager.bindCanvas(connectionId, canvasId);

  // Send ACK to the specific connection that initiated the run.
  // Retry with short delays if the connection is temporarily unavailable
  // (e.g., brief disconnect/reconnect during page transitions).
  const ackMessage = {
    type: "command.ack",
    action: "agent.run",
    payload: response,
  };
  let ackSent = connectionManager.sendTo(connectionId, ackMessage);
  if (!ackSent) {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 500));
      ackSent = connectionManager.sendTo(connectionId, ackMessage);
      if (ackSent) break;
    }
  }
  log.lap("ack_sent", { delivered: ackSent });

  // Track active run so reconnecting clients can detect it
  connectionManager.setActiveRun(canvasId, runId);

  const keepAlive = setInterval(() => {
    connectionManager.sendTo(connectionId, { type: "keep-alive" });
  }, 15_000);

  // Accumulate assistant content blocks for server-side persistence
  const assistantText: string[] = [];
  const assistantBlocks: ContentBlock[] = [];
  let runCanceled = false;

  try {
    let firstEvent = true;
    for await (const event of agentRuns.streamRun(runId)) {
      if (firstEvent) {
        log.lap("first_token");
        firstEvent = false;
      }

      // Buffer for replay on reconnect
      services.eventBuffer?.push(canvasId, event);

      // Broadcast to all viewers
      connectionManager.pushToCanvas(canvasId, event);

      // Accumulate content for server-side persistence
      if (event.type === "message.delta") {
        const lastBlock = assistantBlocks[assistantBlocks.length - 1];
        if (lastBlock && lastBlock.type === "text") {
          (lastBlock as { type: "text"; text: string }).text += event.delta;
        } else {
          assistantBlocks.push({ type: "text", text: event.delta });
        }
        assistantText.push(event.delta);
      } else if (event.type === "tool.started") {
        assistantBlocks.push({
          type: "tool",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: "running" as const,
          ...(event.input ? { input: event.input } : {}),
        });
      } else if (event.type === "tool.completed") {
        const idx = assistantBlocks.findIndex(
          (b) =>
            b.type === "tool" &&
            (b as ToolBlock).toolCallId === event.toolCallId,
        );
        if (idx >= 0) {
          assistantBlocks[idx] = {
            ...(assistantBlocks[idx] as ToolBlock),
            status: "completed" as const,
            ...(event.output ? { output: event.output } : {}),
            ...(event.outputSummary
              ? { outputSummary: event.outputSummary }
              : {}),
            ...(event.artifacts ? { artifacts: event.artifacts } : {}),
          };
        }
      }

      if (event.type === "run.canceled") {
        runCanceled = true;
      }
    }
    log.lap("stream_done", { runCanceled });

    // ── Server-side assistant message persistence ──
    // Persist partial output even when the user canceled, so reconnecting
    // clients see what had already been generated.
    await persistAssistantMessage(
      services.chatService,
      authenticatedUser,
      payload.sessionId,
      assistantText,
      assistantBlocks,
      runCanceled,
      log,
    );
  } catch (error) {
    log.error("stream_error", { failureCategory: "agent_stream" });
    const failedEvent = {
      type: "run.failed" as const,
      runId,
      error: {
        code: "run_failed" as const,
        message: error instanceof Error ? error.message : "Stream failed",
      },
      timestamp: new Date().toISOString(),
    };
    services.eventBuffer?.push(canvasId, failedEvent);
    connectionManager.pushToCanvas(canvasId, failedEvent);
  } finally {
    clearInterval(keepAlive);
    connectionManager.clearActiveRun(canvasId);
  }
}

async function persistAssistantMessage(
  chatService: ChatService | undefined,
  authenticatedUser: AuthenticatedUser,
  sessionId: string,
  assistantText: string[],
  assistantBlocks: ContentBlock[],
  wasCanceled: boolean,
  log: ReturnType<typeof createPipelineLogger>,
) {
  if (
    !chatService ||
    (assistantText.length === 0 && assistantBlocks.length === 0)
  ) {
    return;
  }

  const blocks = wasCanceled
    ? assistantBlocks.map((block) =>
        block.type === "tool" && block.status === "running"
          ? { ...block, status: "completed" as const }
          : block,
      )
    : assistantBlocks;

  try {
    await chatService.createMessage(authenticatedUser, sessionId, {
      role: "assistant",
      content: assistantText.join(""),
      contentBlocks: blocks,
    });
    log.lap("assistant_message_persisted", { wasCanceled });
  } catch {
    log.warn("assistant_message_persist_failed", {
      failureCategory: "assistant_message_persistence",
      wasCanceled,
    });
  }
}
