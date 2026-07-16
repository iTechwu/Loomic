import type { FastifyInstance, FastifyReply } from "fastify";
import {
  applicationErrorResponseSchema,
  skillCreateRequestSchema,
  skillDetailResponseSchema,
  skillImportRequestSchema,
  skillListResponseSchema,
  skillUpdateRequestSchema,
  unauthenticatedErrorResponseSchema,
  workspaceSkillListResponseSchema,
  workspaceSkillToggleRequestSchema,
} from "@lovart.dofe/shared";
import type { NativeSkillRepository } from "../database/skill-repository.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import {
  importSkillFromUrl,
  SkillImportError,
} from "../features/skills/skill-import-service.js";
import type { RequestAuthenticator } from "../supabase/user.js";

export async function registerSkillRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    repository: NativeSkillRepository;
    viewerService: ViewerService;
  },
) {
  app.get("/api/skills", async (request, reply) => {
    if (!(await options.auth.authenticate(request))) return unauth(reply);
    try {
      return reply.send(
        skillListResponseSchema.parse({
          skills: (await options.repository.list()).map(map),
        }),
      );
    } catch (error) {
      return errorReply(
        request,
        reply,
        "skill_query_failed",
        "Unable to load skills.",
      );
    }
  });
  app.get("/api/skills/:id", async (request, reply) => {
    if (!(await options.auth.authenticate(request))) return unauth(reply);
    const id = (request.params as { id: string }).id;
    try {
      const skill = await options.repository.find(id);
      if (!skill)
        return fail(reply, "skill_not_found", "Skill not found.", 404);
      return reply.send(
        skillDetailResponseSchema.parse({
          skill: {
            ...detail(skill),
            files: (await options.repository.files(id)).map(file),
          },
        }),
      );
    } catch (error) {
      return errorReply(
        request,
        reply,
        "skill_query_failed",
        "Unable to load skill.",
      );
    }
  });
  app.get("/api/skills/:id/files", async (request, reply) => {
    if (!(await options.auth.authenticate(request))) return unauth(reply);
    try {
      return reply.send({
        files: (
          await options.repository.files((request.params as { id: string }).id)
        ).map(file),
      });
    } catch (error) {
      return errorReply(
        request,
        reply,
        "skill_file_query_failed",
        "Unable to load skill files.",
      );
    }
  });
  app.post("/api/skills", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauth(reply);
    try {
      const body = skillCreateRequestSchema.parse(request.body);
      const skill = await options.repository.create({
        category: body.category,
        createdBy: user.id,
        description: body.description,
        files: (body.files ?? []).map((f) => ({
          content: f.content,
          filePath: f.filePath,
          mimeType: f.mimeType ?? "text/plain",
        })),
        iconName: body.iconName ?? null,
        name: body.name,
        slug: slug(body.name),
        source: "user",
        skillContent: body.skillContent,
      });
      return reply
        .code(201)
        .send(
          skillDetailResponseSchema.parse({
            skill: {
              ...detail(skill),
              files: (await options.repository.files(String(skill.id))).map(
                file,
              ),
            },
          }),
        );
    } catch (error) {
      return mutationError(
        request,
        reply,
        error,
        "skill_create_failed",
        "Unable to create skill.",
      );
    }
  });
  app.post("/api/skills/import", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauth(reply);
    try {
      const { url } = skillImportRequestSchema.parse(request.body);
      const viewer = await options.viewerService.ensureViewer(user);
      const imported = await importSkillFromUrl(url);
      const skill = await options.repository.create({
        author: imported.manifest.author ?? "unknown",
        category: "custom",
        createdBy: user.id,
        description: imported.manifest.description,
        files: imported.files.map((f) => ({
          content: f.content,
          filePath: f.filePath,
          mimeType: f.mimeType,
        })),
        license: imported.manifest.license ?? null,
        metadata: {
          ...(imported.manifest.metadata ?? {}),
          source_url: imported.sourceUrl,
        },
        name: imported.manifest.name,
        slug: slug(imported.manifest.name),
        source: "user",
        skillContent: imported.skillContent,
        version: imported.manifest.version ?? "1.0",
      });
      await options.repository.install({
        enabled: true,
        installedBy: user.id,
        skillId: String(skill.id),
        userId: user.id,
        workspaceId: viewer.workspace.id,
      });
      request.log.info({ skillId: skill.id, sourceUrl: url }, "skill_imported");
      return reply
        .code(201)
        .send(
          skillDetailResponseSchema.parse({
            skill: {
              ...detail(skill),
              files: (await options.repository.files(String(skill.id))).map(
                file,
              ),
            },
          }),
        );
    } catch (error) {
      if (error instanceof SkillImportError)
        return fail(reply, "skill_import_failed", error.message, 400);
      return mutationError(
        request,
        reply,
        error,
        "skill_import_failed",
        "Failed to import skill.",
      );
    }
  });
  app.put("/api/skills/:id", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauth(reply);
    try {
      const body = skillUpdateRequestSchema.parse(request.body);
      if (!Object.keys(body).length)
        return fail(reply, "skill_update_failed", "No fields to update.", 400);
      const skill = await options.repository.update(
        user.id,
        (request.params as { id: string }).id,
        {
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.iconName !== undefined ? { iconName: body.iconName } : {}),
          ...(body.name !== undefined
            ? { name: body.name, slug: slug(body.name) }
            : {}),
          ...(body.skillContent !== undefined
            ? { skillContent: body.skillContent }
            : {}),
        },
      );
      if (!skill)
        return fail(
          reply,
          "skill_not_found",
          "Skill not found or access denied.",
          404,
        );
      return reply.send(
        skillDetailResponseSchema.parse({ skill: detail(skill) }),
      );
    } catch (error) {
      return mutationError(
        request,
        reply,
        error,
        "skill_update_failed",
        "Unable to update skill.",
      );
    }
  });
  app.delete("/api/skills/:id", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauth(reply);
    try {
      if (
        !(await options.repository.delete(
          user.id,
          (request.params as { id: string }).id,
        ))
      )
        return fail(
          reply,
          "skill_not_found",
          "Skill not found or access denied.",
          404,
        );
      return reply.code(204).send();
    } catch (error) {
      return errorReply(
        request,
        reply,
        "skill_delete_failed",
        "Unable to delete skill.",
      );
    }
  });
  app.get("/api/workspaces/skills", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauth(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      const skills = (
        await options.repository.listInstalled(user.id, viewer.workspace.id)
      ).map((row) => ({
        ...map(row),
        installed: true,
        enabled: Boolean(row.enabled),
        installedAt: iso(row.installed_at),
      }));
      return reply.send(workspaceSkillListResponseSchema.parse({ skills }));
    } catch (error) {
      return errorReply(
        request,
        reply,
        "skill_query_failed",
        "Unable to load workspace skills.",
      );
    }
  });
  app.post("/api/workspaces/skills", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauth(reply);
    const skillId = (request.body as { skillId?: unknown })?.skillId;
    if (typeof skillId !== "string")
      return fail(reply, "skill_install_failed", "skillId is required.", 400);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      if (
        !(await options.repository.install({
          enabled: true,
          installedBy: user.id,
          skillId,
          userId: user.id,
          workspaceId: viewer.workspace.id,
        }))
      )
        return fail(reply, "skill_not_found", "Skill not found.", 404);
      return reply.code(204).send();
    } catch (error) {
      return errorReply(
        request,
        reply,
        "skill_install_failed",
        "Unable to install skill.",
      );
    }
  });
  app.delete("/api/workspaces/skills/:skillId", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauth(reply);
    try {
      const viewer = await options.viewerService.ensureViewer(user);
      if (
        !(await options.repository.uninstall(
          user.id,
          viewer.workspace.id,
          (request.params as { skillId: string }).skillId,
        ))
      )
        return fail(
          reply,
          "skill_not_found",
          "Skill is not installed in this workspace.",
          404,
        );
      return reply.code(204).send();
    } catch (error) {
      return errorReply(
        request,
        reply,
        "skill_uninstall_failed",
        "Unable to uninstall skill.",
      );
    }
  });
  app.patch("/api/workspaces/skills/:skillId", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauth(reply);
    try {
      const body = workspaceSkillToggleRequestSchema.parse(request.body);
      const viewer = await options.viewerService.ensureViewer(user);
      if (
        !(await options.repository.install({
          enabled: body.enabled,
          installedBy: user.id,
          skillId: (request.params as { skillId: string }).skillId,
          userId: user.id,
          workspaceId: viewer.workspace.id,
        }))
      )
        return fail(reply, "skill_not_found", "Skill not found.", 404);
      return reply.code(204).send();
    } catch (error) {
      return mutationError(
        request,
        reply,
        error,
        "skill_toggle_failed",
        "Unable to toggle skill.",
      );
    }
  });
}
function iso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}
function map(row: any) {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: String(row.description),
    author: String(row.author),
    version: String(row.version),
    category: String(row.category),
    iconName: row.icon_name ?? null,
    source: String(row.source),
    isFeatured: Boolean(row.is_featured),
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function detail(row: any) {
  return {
    ...map(row),
    license: row.license ?? null,
    skillContent: String(row.skill_content),
    createdBy: row.created_by ?? null,
    sourceUrl: row.metadata?.source_url ?? null,
    packageName: row.metadata?.package_name ?? null,
  };
}
function file(row: any) {
  return {
    id: String(row.id),
    filePath: String(row.file_path),
    content: String(row.content),
    mimeType: String(row.mime_type),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
function slug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
function unauth(reply: FastifyReply) {
  return reply
    .code(401)
    .send(
      unauthenticatedErrorResponseSchema.parse({
        error: {
          code: "unauthorized",
          message: "Missing or invalid bearer token.",
        },
      }),
    );
}
function fail(
  reply: FastifyReply,
  code: string,
  message: string,
  status = 500,
) {
  return reply
    .code(status)
    .send(applicationErrorResponseSchema.parse({ error: { code, message } }));
}
function errorReply(
  request: any,
  reply: FastifyReply,
  code: string,
  message: string,
) {
  request.log.error({ err: request.error }, code);
  return fail(reply, code, message);
}
function mutationError(
  request: any,
  reply: FastifyReply,
  error: unknown,
  code: string,
  message: string,
) {
  if (error instanceof Error && error.name === "ZodError")
    return reply
      .code(400)
      .send({ issues: (error as any).issues, message: "Invalid request body" });
  request.log.error({ err: error }, code);
  return fail(
    reply,
    code,
    message,
    (error as any)?.code === "23505" ? 409 : 500,
  );
}
