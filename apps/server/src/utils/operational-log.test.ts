import { describe, expect, it, vi } from "vitest";

import {
  logOperationalFailure,
  logOperationalInfo,
  logOperationalWarning,
} from "./operational-log.js";

describe("operational log", () => {
  it("writes failures with only the stable category", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      logOperationalFailure(
        "[project-service] create failed",
        "project_create",
      );
      expect(error).toHaveBeenCalledWith("[project-service] create failed", {
        failureCategory: "project_create",
      });
    } finally {
      error.mockRestore();
    }
  });

  it("writes warnings with only the stable category", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      logOperationalWarning(
        "[canvas-service] file deferred",
        "canvas_file_extract",
      );
      expect(warn).toHaveBeenCalledWith("[canvas-service] file deferred", {
        failureCategory: "canvas_file_extract",
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("writes informational outcomes without arbitrary context", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      logOperationalInfo("[worker] job succeeded", "worker_job_succeeded");
      expect(info).toHaveBeenCalledWith("[worker] job succeeded", {
        outcomeCategory: "worker_job_succeeded",
      });
    } finally {
      info.mockRestore();
    }
  });
});
