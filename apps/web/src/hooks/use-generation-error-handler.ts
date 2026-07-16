"use client";

import { useCallback } from "react";

import { ApiApplicationError } from "@/lib/server-api";
import { useToast } from "@/components/toast";

/**
 * Returns a handler function that inspects generation errors and routes them
 * to the shared, non-financial error UI. Billing and model entitlements are
 * owned by models.dofe.ai and are not interpreted in this client.
 *
 * @returns handleGenerationError(error) => boolean — true if the error was a
 *          handled error (i.e. caller should NOT show its own error UI)
 */
export function useGenerationErrorHandler() {
  const { error: showErrorToast } = useToast();

  const handleGenerationError = useCallback(
    (error: unknown): boolean => {
      if (!(error instanceof ApiApplicationError)) {
        // Not an application error — log for debugging, show generic toast to user
        console.error("[generation-error] Unexpected error:", error);
        showErrorToast("生成失败，请重试。");
        return false;
      }

      // Other application errors: log raw message, show generic toast to user
      console.error("[generation-error] Application error:", error.code, error.message);
      showErrorToast("生成失败，请重试。");
      return false;
    },
    [showErrorToast],
  );

  return { handleGenerationError };
}
