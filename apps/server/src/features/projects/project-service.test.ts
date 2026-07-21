import { describe, expect, it, vi } from "vitest";

import { createProjectService } from "./project-service.js";

const USER_ID = "00000000-0000-4000-8000-000000000010";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000020";

describe("project creation", () => {
  it("allows repeated display names by generating distinct persistence slugs", async () => {
    const usedSlugs = new Set<string>();
    const createProject = vi.fn(async (input: { slug: string }) => {
      if (usedSlugs.has(input.slug)) throw { code: "23505" };
      usedSlugs.add(input.slug);
      return projectRow(input.slug);
    });
    const service = projectService(createProject);

    const first = await service.createProject(user(), { name: "未命名" });
    const second = await service.createProject(user(), { name: "未命名" });

    expect(createProject).toHaveBeenCalledTimes(2);
    expect(first.slug).not.toBe(second.slug);
    expect(first.slug).toMatch(/^untitled-[0-9a-f-]{36}$/);
    expect(second.slug).toMatch(/^untitled-[0-9a-f-]{36}$/);
  });

  it("retries a generated slug collision without returning a conflict to the user", async () => {
    const createProject = vi
      .fn()
      .mockRejectedValueOnce({ code: "23505" })
      .mockImplementationOnce(async (input: { slug: string }) =>
        projectRow(input.slug),
      );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const service = projectService(createProject);

    try {
      const result = await service.createProject(user(), { name: "未命名" });
      const firstSlug = createProject.mock.calls[0]?.[0].slug;
      const secondSlug = createProject.mock.calls[1]?.[0].slug;

      expect(createProject).toHaveBeenCalledTimes(2);
      expect(result.slug).toBe(secondSlug);
      expect(firstSlug).toMatch(/^untitled-/);
      expect(secondSlug).not.toBe(firstSlug);
      expect(warning).toHaveBeenCalledWith(
        "[project-service] slug collision; retrying",
        { failureCategory: "project_slug_collision_retry" },
      );
    } finally {
      warning.mockRestore();
    }
  });
});

function projectService(createProject: ReturnType<typeof vi.fn>) {
  return createProjectService({
    repository: { createProject } as never,
    storage: { createReadUrl: vi.fn() } as never,
    viewerService: {
      ensureViewer: vi.fn(async () => ({
        workspace: {
          id: WORKSPACE_ID,
          name: "Personal Workspace",
          ownerUserId: USER_ID,
          type: "personal",
        },
      })),
    } as never,
  });
}

function projectRow(slug: string) {
  const now = new Date("2026-07-21T00:00:00.000Z");
  return {
    brand_kit_id: null,
    canvas_id: "canvas-1",
    canvas_is_primary: true,
    canvas_name: "Main Canvas",
    created_at: now,
    description: null,
    id: "project-1",
    name: "未命名",
    slug,
    thumbnail_path: null,
    updated_at: now,
    workspace_id: WORKSPACE_ID,
  };
}

function user() {
  return {
    accessToken: "test-token",
    email: "project-test@example.com",
    id: USER_ID,
    tenantId: USER_ID,
    userMetadata: {},
  };
}
