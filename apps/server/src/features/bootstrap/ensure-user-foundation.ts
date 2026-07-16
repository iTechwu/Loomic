import type { ViewerResponse } from "@lovart.dofe/shared";

import type { NativeDataRepository } from "../../database/native-data-repository.js";
import type { AuthenticatedUser } from "../../supabase/user.js";

const BOOTSTRAP_FAILED_MESSAGE = "Unable to prepare viewer workspace.";

export type ViewerService = {
  ensureViewer(user: AuthenticatedUser): Promise<ViewerResponse>;
  updateProfile(user: AuthenticatedUser, displayName: string): Promise<ViewerResponse["profile"]>;
};

export class BootstrapError extends Error {
  readonly code = "bootstrap_failed";
  readonly statusCode = 500;

  constructor() {
    super(BOOTSTRAP_FAILED_MESSAGE);
  }
}

export function createViewerService(options: { repository: NativeDataRepository }): ViewerService {
  return {
    async ensureViewer(user) {
      try {
        return await options.repository.ensureViewer({
          avatarUrl: stringValue(user.userMetadata.avatar_url),
          displayName: displayName(user),
          email: user.email,
          userId: user.id,
        });
      } catch (error) {
        console.error("[viewer-service] workspace bootstrap failed", {
          message: error instanceof Error ? error.message : String(error),
          userId: user.id,
        });
        throw new BootstrapError();
      }
    },
    async updateProfile(user, name) {
      const profile = await options.repository.updateProfile(user.id, name);
      if (!profile) throw new BootstrapError();
      return profile;
    },
  };
}

function displayName(user: AuthenticatedUser): string {
  const fromMetadata = stringValue(user.userMetadata.name);
  return fromMetadata || user.email.split("@", 1)[0] || "Personal";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
