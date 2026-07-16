import type { FastifyInstance, FastifyReply } from "fastify";
import {
  applicationErrorResponseSchema,
  marketplaceInstallRequestSchema,
  skillDetailResponseSchema,
  unauthenticatedErrorResponseSchema,
} from "@lovart.dofe/shared";
import type { NativeSkillRepository } from "../database/skill-repository.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import {
  getMarketplaceDetail,
  installFromMarketplace,
  MarketplaceError,
  searchMarketplace,
} from "../features/skills/marketplace-service.js";
import type { RequestAuthenticator } from "../supabase/user.js";

export async function registerMarketplaceRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    repository: NativeSkillRepository;
    viewerService: ViewerService;
  },
) {
  app.get("/api/skills/marketplace/search", async (request, reply) => {
    if (!(await options.auth.authenticate(request))) return unauth(reply);
    try {
      const {
        q = "",
        page = "1",
        limit = "20",
      } = request.query as Record<string, string>;
      return reply.send(
        await searchMarketplace(q, Number(page), Number(limit)),
      );
    } catch (error) {
      return marketplaceError(
        request,
        reply,
        error,
        "marketplace_search_failed",
        "Marketplace search failed.",
      );
    }
  });
  app.get("/api/skills/marketplace/detail", async (request, reply) => {
    if (!(await options.auth.authenticate(request))) return unauth(reply);
    const { name } = request.query as { name?: string };
    if (!name)
      return fail(
        reply,
        "marketplace_detail_failed",
        "Package name is required.",
        400,
      );
    try {
      return reply.send(await getMarketplaceDetail(name));
    } catch (error) {
      return marketplaceError(
        request,
        reply,
        error,
        "marketplace_detail_failed",
        "Failed to fetch package detail.",
      );
    }
  });
  app.post("/api/skills/marketplace/install", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauth(reply);
    try {
      const { packageName } = marketplaceInstallRequestSchema.parse(
        request.body,
      );
      const viewer = await options.viewerService.ensureViewer(user);
      const { imported, packageName: resolvedPackageName } =
        await installFromMarketplace(packageName);
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
          source_url: `https://www.npmjs.com/package/${packageName}`,
          package_name: resolvedPackageName,
        },
        name: imported.manifest.name,
        slug: slug(imported.manifest.name),
        source: "marketplace",
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
      request.log.info(
        { packageName, skillId: skill.id },
        "marketplace_skill_installed",
      );
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
      return marketplaceError(
        request,
        reply,
        error,
        "marketplace_install_failed",
        "Failed to install marketplace skill.",
      );
    }
  });
}
function iso(v: unknown) {
  return v instanceof Date
    ? v.toISOString()
    : new Date(String(v)).toISOString();
}
function detail(row: any) {
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
function marketplaceError(
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
  if (error instanceof MarketplaceError)
    return fail(
      reply,
      code,
      error.message,
      error.code === "package_not_found" ? 404 : 502,
    );
  request.log.error({ err: error }, code);
  return fail(reply, code, message);
}
