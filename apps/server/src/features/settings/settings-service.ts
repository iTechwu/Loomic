import type { WorkspaceSettings } from "@lovart.dofe/shared";
import { DEFAULT_CHAT_MODEL } from "@lovart.dofe/shared";
import type { AuthenticatedUser } from "../../auth/sso-authenticator.js";
import type { NativeSettingsRepository } from "../../database/settings-repository.js";
const FALLBACK_MODEL = DEFAULT_CHAT_MODEL;
export class SettingsServiceError extends Error {
  constructor(
    readonly code:
      | "settings_not_found"
      | "settings_read_failed"
      | "settings_update_failed",
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}
export type SettingsService = {
  getWorkspaceSettings(
    user: AuthenticatedUser,
    workspaceId: string,
  ): Promise<WorkspaceSettings>;
  updateWorkspaceSettings(
    user: AuthenticatedUser,
    workspaceId: string,
    settings: WorkspaceSettings,
  ): Promise<WorkspaceSettings>;
};
export function createSettingsService(options: {
  repository: NativeSettingsRepository;
  defaultModel?: string;
}): SettingsService {
  const fallback = options.defaultModel ?? FALLBACK_MODEL;
  return {
    async getWorkspaceSettings(user, workspaceId) {
      try {
        return {
          defaultModel:
            (await options.repository.get(user.id, workspaceId)) ?? fallback,
        };
      } catch {
        throw new SettingsServiceError(
          "settings_read_failed",
          "Unable to load workspace settings.",
          500,
        );
      }
    },
    async updateWorkspaceSettings(user, workspaceId, settings) {
      try {
        if (
          !(await options.repository.set(
            user.id,
            workspaceId,
            settings.defaultModel,
          ))
        )
          throw new Error("not authorized");
        return settings;
      } catch {
        throw new SettingsServiceError(
          "settings_update_failed",
          "Unable to update workspace settings.",
          500,
        );
      }
    },
  };
}
