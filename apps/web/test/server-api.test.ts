// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  FILE_UPLOAD_TIMEOUT_MS,
  createRun,
  fetchModels,
  fetchViewer,
  fetchProjects,
  createProject,
  generateVideoDirect,
  uploadFile,
} from "../src/lib/server-api";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("authenticated server API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:3001");
  });

  it("fetchViewer sends bearer token and returns viewer response", async () => {
    const viewer = {
      profile: { id: "u1", email: "a@b.com", displayName: "A", avatarUrl: null },
      workspace: { id: "w1", name: "W", type: "personal", ownerUserId: "u1" },
      membership: { workspaceId: "w1", userId: "u1", role: "owner" },
    };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => viewer });

    const result = await fetchViewer("token_abc");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/viewer",
      expect.objectContaining({
        headers: { Authorization: "Bearer token_abc" },
      }),
    );
    expect(result.profile.id).toBe("u1");
  });

  it("fetchModels sends bearer token and maps 401 to ApiAuthError", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    });

    await expect(fetchModels("token_abc")).resolves.toEqual({ models: [] });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer token_abc" },
      }),
    );

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: "unauthorized", message: "Bad token." },
      }),
    });
    await expect(fetchModels("expired")).rejects.toThrow("unauthorized");
  });

  it("generateVideoDirect omits model-controlled parameters until selected", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        url: "https://example.com/video.mp4",
        assetId: "asset_1",
        prompt: "A video",
        mimeType: "video/mp4",
        width: 1280,
        height: 720,
        durationSeconds: 5,
      }),
    });

    await generateVideoDirect("token_abc", "A video", {
      model: "authorized-video",
      aspectRatio: "16:9",
    });

    const request = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      prompt: "A video",
      model: "authorized-video",
      aspectRatio: "16:9",
    });
  });

  it("createRun sends bearer auth when access token is provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        runId: "run_123",
        sessionId: "session_123",
        conversationId: "conversation_123",
        status: "accepted",
      }),
    });

    await createRun(
      {
        sessionId: "session_123",
        conversationId: "conversation_123",
        prompt: "Hello",
      },
      { accessToken: "token_abc" },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/agent/runs",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer token_abc",
          "content-type": "application/json",
        },
      }),
    );
  });

  it("createRun keeps demo calls unauthenticated by default", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        runId: "run_123",
        sessionId: "session_123",
        conversationId: "conversation_123",
        status: "accepted",
      }),
    });

    await createRun({
      sessionId: "session_123",
      conversationId: "conversation_123",
      prompt: "Hello",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/agent/runs",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      }),
    );
  });

  it("createProject sends POST with bearer token and handles 201", async () => {
    const project = {
      project: {
        id: "p1", name: "Test", slug: "test", description: null,
        workspace: { id: "w1", name: "W", type: "personal", ownerUserId: "u1" },
        primaryCanvas: { id: "c1", name: "Main Canvas", isPrimary: true },
        createdAt: "2026-03-23T00:00:00Z", updatedAt: "2026-03-23T00:00:00Z",
      },
    };
    mockFetch.mockResolvedValue({ ok: true, status: 201, json: async () => project });

    const result = await createProject("token_abc", { name: "Test" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/projects",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token_abc",
          "content-type": "application/json",
        }),
      }),
    );
    expect(result.project.id).toBe("p1");
  });

  it("fetchProjects sends bearer token and returns list", async () => {
    const list = { projects: [{ id: "p1", name: "Test", slug: "test" }] };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => list });

    const result = await fetchProjects("token_abc");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/projects",
      expect.objectContaining({
        headers: { Authorization: "Bearer token_abc" },
      }),
    );
    expect(result.projects).toHaveLength(1);
  });

  it("createProject throws ApiApplicationError with code on 409", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: { code: "project_slug_taken", message: "Slug taken." },
      }),
    });

    await expect(createProject("token_abc", { name: "Dup" })).rejects.toThrow(
      "Slug taken.",
    );
    try {
      await createProject("token_abc", { name: "Dup" });
    } catch (err) {
      expect((err as any).code).toBe("project_slug_taken");
    }
  });

  it("fetchViewer throws ApiAuthError on 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: "unauthorized", message: "Bad token." },
      }),
    });

    await expect(fetchViewer("expired")).rejects.toThrow("unauthorized");
  });

  it("fetchProjects throws ApiAuthError on 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: "unauthorized", message: "Bad token." },
      }),
    });

    await expect(fetchProjects("expired")).rejects.toThrow("unauthorized");
  });

  it("aborts a stalled upload and returns a retryable timeout message", async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    const upload = uploadFile(
      "token_abc",
      new File(["image"], "reference.png", { type: "image/png" }),
    );
    const timeoutError = expect(upload).rejects.toThrow(
      "上传超时，请检查网络后重试。",
    );
    await vi.advanceTimersByTimeAsync(FILE_UPLOAD_TIMEOUT_MS);

    await timeoutError;
    vi.useRealTimers();
  });
});
