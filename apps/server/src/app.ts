import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import type { LovartDofeAgentFactory } from "./agent/deep-agent.js";
import {
  createAgentPersistenceService,
  type AgentPersistenceService,
} from "./agent/persistence/index.js";
import { createAgentRunService } from "./agent/runtime.js";
import { registerAllProviders } from "./generation/providers/register-all.js";
import {
  createViewerService,
  type ViewerService,
} from "./features/bootstrap/ensure-user-foundation.js";
import {
  createCanvasService,
  type CanvasService,
} from "./features/canvas/canvas-service.js";
import {
  createBrandKitService,
  type BrandKitService,
} from "./features/brand-kit/brand-kit-service.js";
import {
  createProjectService,
  type ProjectService,
} from "./features/projects/project-service.js";
import {
  createChatService,
  type ChatService,
} from "./features/chat/chat-service.js";
import {
  createThreadService,
  type ThreadService,
} from "./features/chat/thread-service.js";
import {
  createAgentRunMetadataService,
  type AgentRunMetadataService,
} from "./features/agent-runs/agent-run-service.js";
import {
  createSettingsService,
  type SettingsService,
} from "./features/settings/settings-service.js";
import {
  createUploadService,
  type UploadService,
} from "./features/uploads/upload-service.js";
import { type ServerEnv, loadServerEnv, resolveDefaultAgentModel } from "./config/env.js";
import { createRabbitMqClient } from "./queue/rabbitmq-client.js";
import { createRedisClient } from "./cache/redis-client.js";
import { createNativeJobRepository } from "./database/job-repository.js";
import { createNativeChatRepository } from "./database/chat-repository.js";
import { createNativeSettingsRepository } from "./database/settings-repository.js";
import {
  createJobService,
  type JobService,
} from "./features/jobs/job-service.js";
import { registerFontsRoutes } from "./http/fonts.js";
import { registerJobRoutes } from "./http/jobs.js";
import { registerBrandKitRoutes } from "./http/brand-kits.js";
import { registerCanvasRoutes } from "./http/canvases.js";
import { registerChatRoutes } from "./http/chat.js";
import { registerGenerateRoutes } from "./http/generate.js";
import { registerHealthRoutes } from "./http/health.js";
import {
  registerAuthTransferTelemetryReadiness,
  registerAuthTransferTelemetryRoute,
} from "./http/auth-transfer-telemetry.js";
import { registerImageProxyRoute } from "./http/image-proxy.js";
import { registerModelRoutes } from "./http/models.js";
import { registerOidcAuthRoutes } from "./http/oidc-auth.js";
import { registerImageModelRoutes } from "./http/image-models.js";
import { registerVideoModelRoutes } from "./http/video-models.js";
import { registerProjectRoutes } from "./http/projects.js";
import { registerRunRoutes } from "./http/runs.js";
import { registerSettingsRoutes } from "./http/settings.js";
import { registerUploadRoutes } from "./http/uploads.js";
import { registerSkillRoutes } from "./http/skills.js";
import { registerMarketplaceRoutes } from "./http/skills-marketplace.js";
import { registerViewerRoutes } from "./http/viewer.js";
import { CanvasEventBuffer } from "./ws/event-buffer.js";
import { ConnectionManager } from "./ws/connection-manager.js";
import { registerWsRoute } from "./ws/handler.js";
import { createDatabasePool } from "./database/pool.js";
import { createNativeDataRepository } from "./database/native-data-repository.js";
import { createNativeSkillRepository } from "./database/skill-repository.js";
import { createSsoIdentityRepository } from "./database/sso-identity-repository.js";
import { createCredentialCrypto } from "./features/credentials/crypto.js";
import {
  createCredentialsService,
  type CredentialsService,
} from "./features/credentials/credentials-service.js";
import { createUserCredentialsRepository } from "./features/credentials/credentials-repository.js";
import { createConfiguredTosObjectStorage } from "./storage/tos-object-storage.js";
import { createCanvasElementWriter } from "./features/canvas/canvas-element-writer.js";
import { createSsoRequestAuthenticator, type RequestAuthenticator } from "./auth/sso-authenticator.js";

export type BuildAppOptions = {
  agentFactory?: LovartDofeAgentFactory;
  agentModel?: BaseLanguageModel | string;
  agentPersistenceService?: AgentPersistenceService;
  agentRunMetadataService?: AgentRunMetadataService;
  auth?: RequestAuthenticator;
  brandKitService?: BrandKitService;
  canvasService?: CanvasService;
  chatService?: ChatService;
  connectionManager?: ConnectionManager;
  env?: Partial<ServerEnv>;
  jobService?: JobService;
  uploadService?: UploadService;
  mockEventDelayMs?: number;
  projectService?: ProjectService;
  settingsService?: SettingsService;
  threadService?: ThreadService;
  viewerService?: ViewerService;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const env = loadServerEnv(options.env);

  // Register generation providers (shared with worker.ts)
  registerAllProviders(env);

  const app = Fastify({
    logger: { level: "info" },
  });
  void app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  void app.register(async (instance) => {
    await instance.register(websocket);
    await registerWsRoute(instance, {
      agentRuns,
      agentRunMetadataService,
      auth,
      chatService,
      connectionManager,
      eventBuffer,
      settingsService,
      threadService,
      viewerService,
    });
  });
  if (!env.databaseUrl || !env.tos) {
    throw new Error("DATABASE_URL and complete TOS_* configuration are required for the native metadata data plane.");
  }
  const databasePool = createDatabasePool(env.databaseUrl);
  const identities = createSsoIdentityRepository(databasePool);

  // Per-user models credential provisioning + resolution. Disabled when the
  // models internal secret or base URL isn't configured (e.g. local dev without
  // models); in that case model calls fall back to whatever provider keys exist
  // and provisioning is skipped.
  const credentialCrypto = createCredentialCrypto(env.lovartCredentialEncryptionKey);
  const credentialsEnabled = Boolean(
    credentialCrypto.enabled && env.internalApiSecret && env.dofeModelBaseUrl,
  );
  if (!credentialsEnabled && (env.internalApiSecret || env.dofeModelBaseUrl)) {
    app.log.error(
      "[credentials] provisioning disabled: LOVART_CREDENTIAL_ENCRYPTION_KEY, INTERNAL_API_SECRET, and DOFE_MODEL_BASE_URL are required.",
    );
  }
  const credentialsService: CredentialsService | undefined =
    credentialsEnabled && env.internalApiSecret && env.dofeModelBaseUrl
      ? createCredentialsService({
          repository: createUserCredentialsRepository(databasePool),
          crypto: credentialCrypto,
          provisionConfig: {
            baseUrl: env.dofeModelBaseUrl,
            serviceName: env.lovartModelsServiceName ?? "lovart.dofe.ai",
            internalApiSecret: env.internalApiSecret,
          },
          logger: {
            info: (message, data) => app.log.info(data ?? {}, message),
            warn: (message, data) => app.log.warn(data ?? {}, message),
            error: (message, data) => app.log.error(data ?? {}, message),
          },
        })
      : undefined;
  const auth = options.auth ?? createSsoRequestAuthenticator(env, identities);
  const dataRepository = createNativeDataRepository(databasePool);
  const skillRepository = createNativeSkillRepository(databasePool);
  const chatRepository = createNativeChatRepository(databasePool);
  const settingsRepository = createNativeSettingsRepository(databasePool);
  const objectStorage = createConfiguredTosObjectStorage(env.tos);
  const canvasElementWriter = createCanvasElementWriter({ repository: dataRepository, storage: objectStorage });
  app.addHook("onClose", async () => databasePool.end());
  const viewerService =
    options.viewerService ??
    createViewerService({
      repository: dataRepository,
      ...(credentialsService ? { credentialsService } : {}),
    });
  const projectService =
    options.projectService ??
    createProjectService({ repository: dataRepository, storage: objectStorage, viewerService });
  const brandKitService =
    options.brandKitService ?? createBrandKitService({ pool: databasePool, storage: objectStorage });
  const canvasService =
    options.canvasService ?? createCanvasService({ repository: dataRepository, storage: objectStorage });
  const threadService =
    options.threadService ?? createThreadService({ repository: chatRepository });
  const chatService =
    options.chatService ?? createChatService({ repository: chatRepository, threadService });
  const agentRunMetadataService =
    options.agentRunMetadataService ??
    createAgentRunMetadataService({ pool: databasePool });
  const agentPersistenceService =
    options.agentPersistenceService ?? createAgentPersistenceService(env);
  const settingsService =
    options.settingsService ??
      createSettingsService({
        repository: settingsRepository,
        defaultModel: resolveDefaultAgentModel(env),
      });
  const uploadService =
    options.uploadService ?? createUploadService({ repository: dataRepository, storage: objectStorage });
  const rabbitMq = env.rabbitMqUrl ? createRabbitMqClient(env.rabbitMqUrl) : undefined;
  const telemetryRedis = env.redisUrl ? createRedisClient(env.redisUrl) : undefined;
  const jobRepository = createNativeJobRepository(databasePool);
  if (rabbitMq) app.addHook("onClose", async () => rabbitMq.close());
  if (telemetryRedis) app.addHook("onClose", async () => telemetryRedis.close());
  registerAuthTransferTelemetryReadiness(app, telemetryRedis?.connection);
  const jobService =
    options.jobService ??
    (rabbitMq
      ? createJobService({ repository: jobRepository, rabbitMq })
      : undefined);
  const connectionManager = options.connectionManager ?? new ConnectionManager();
  const eventBuffer = new CanvasEventBuffer();
  setInterval(() => eventBuffer.cleanup(), 5 * 60 * 1000);
  const agentRuns = createAgentRunService({
    agentPersistenceService,
    ...(options.agentFactory ? { agentFactory: options.agentFactory } : {}),
    agentRunMetadataService,
    brandKitService,
    canvasElementWriter,
    dataRepository,
    databasePool,
    connectionManager,
    ...(options.agentModel ? { model: options.agentModel } : {}),
    ...(options.mockEventDelayMs === undefined
      ? {}
      : { eventDelayMs: options.mockEventDelayMs }),
    env,
    ...(credentialsService ? { credentialsService } : {}),
    objectStorage,
    ...(jobService ? { jobService } : {}),
    viewerService,
  });

  app.addHook("onRequest", async (request, reply) => {
    const corsResult = evaluateCors(request, env.webOrigin);

    if (!corsResult.allowed) {
      return reply.code(403).send({
        message: "Origin not allowed",
      });
    }

    if (corsResult.allowOrigin) {
      reply.header("access-control-allow-origin", corsResult.allowOrigin);
      reply.header("vary", "Origin");
    }

    if (corsResult.isBrowserRequest) {
      reply.header("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      reply.header(
        "access-control-allow-headers",
        resolveAllowedHeaders(
          request.headers["access-control-request-headers"],
        ),
      );
    }

    if (corsResult.isPreflight) {
      return reply.code(204).send();
    }
  });

  void registerHealthRoutes(app, env);
  void registerAuthTransferTelemetryRoute(app, {
    ...(telemetryRedis ? { redis: telemetryRedis.connection } : {}),
  });
  void registerOidcAuthRoutes(app, {
    env,
    identities,
    ...(credentialsService ? { credentialsService } : {}),
  });
  void registerFontsRoutes(app, { env });
  void registerImageProxyRoute(app);
  void registerRunRoutes(app, agentRuns, {
    agentRunMetadataService,
    auth,
    settingsService,
    threadService,
    viewerService,
  });
  void registerViewerRoutes(app, {
    auth,
    viewerService,
  });
  void registerBrandKitRoutes(app, {
    auth,
    brandKitService,
  });
  void registerProjectRoutes(app, {
    auth,
    projectService,
  });
  void registerCanvasRoutes(app, {
    auth,
    canvasService,
  });
  void registerSettingsRoutes(app, {
    auth,
    settingsService,
    viewerService,
  });
  void registerModelRoutes(app, env);
  void registerImageModelRoutes(app, { auth, viewerService });
  void registerVideoModelRoutes(app, { auth, viewerService });
  void registerChatRoutes(app, {
    auth,
    chatService,
  });
  void registerUploadRoutes(app, {
    auth,
    uploadService,
    viewerService,
  });
  void registerGenerateRoutes(app, {
    auth,
    uploadService,
    viewerService,
    ...(credentialsService ? { credentialsService } : {}),
    ...(jobService ? { jobService } : {}),
  });
  if (jobService) {
    void registerJobRoutes(app, { auth, jobService, viewerService });
  }
  void registerSkillRoutes(app, { auth, repository: skillRepository, viewerService });
  void registerMarketplaceRoutes(app, { auth, repository: skillRepository, viewerService });

  return app;
}

type CorsResult = {
  allowed: boolean;
  allowOrigin: string | null;
  isBrowserRequest: boolean;
  isPreflight: boolean;
};

function evaluateCors(request: FastifyRequest, webOrigin: string): CorsResult {
  const origin = request.headers.origin;
  const isPreflight =
    request.method === "OPTIONS" &&
    typeof request.headers["access-control-request-method"] === "string";

  if (!origin) {
    return {
      allowed: true,
      allowOrigin: null,
      isBrowserRequest: false,
      isPreflight,
    };
  }

  if (origin === webOrigin) {
    return {
      allowed: true,
      allowOrigin: origin,
      isBrowserRequest: true,
      isPreflight,
    };
  }

  if (origin === "null" && isLoopbackHost(request.headers.host)) {
    return {
      allowed: true,
      allowOrigin: origin,
      isBrowserRequest: true,
      isPreflight,
    };
  }

  return {
    allowed: false,
    allowOrigin: null,
    isBrowserRequest: true,
    isPreflight,
  };
}

function resolveAllowedHeaders(requestHeaders: string | undefined) {
  return requestHeaders?.trim() || "Content-Type";
}

function isLoopbackHost(host: string | undefined) {
  if (!host) {
    return false;
  }

  if (host.startsWith("[")) {
    return host.startsWith("[::1]");
  }

  const [hostname] = host.split(":");
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
  );
}
