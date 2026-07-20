import type { ViewerResponse } from "@lovart.dofe/shared";

import type { NativeDataRepository } from "../../database/native-data-repository.js";
import type { AuthenticatedUser } from "../../auth/sso-authenticator.js";
import type { CredentialsService } from "../credentials/credentials-service.js";

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

export function createViewerService(options: {
  repository: NativeDataRepository;
  /**
   * Optional credentials service. When provided, ensureViewer triggers
   * idempotent per-user credential provisioning after the workspace is ready,
   * so model calls can authenticate with the user's own models key.
   */
  credentialsService?: CredentialsService;
}): ViewerService {
  return {
    async ensureViewer(user) {
      try {
        const viewer = await options.repository.ensureViewer({
          avatarUrl: stringValue(user.userMetadata.avatar_url),
          displayName: displayName(user),
          email: user.email,
          userId: user.id,
        });

        // Fire-and-forget credential provisioning (idempotent). The OIDC login
        // path also provisions, but this guarantees coverage for sessions
        // resumed via refresh or direct bearer token. Provisioning failures
        // are logged inside the service and retried on the next viewer call;
        // they never block workspace access. Strict no-fallback is enforced at
        // model-call time (CredentialsService.getByUserId).
        if (options.credentialsService) {
          void options.credentialsService
            .ensureProvisioned({ userId: user.id })
            .catch(() => {
              /* errors are already logged inside ensureProvisioned */
            });
        }
        return viewer;
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
