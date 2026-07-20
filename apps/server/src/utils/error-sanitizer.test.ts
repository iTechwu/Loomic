import { describe, expect, it, vi } from "vitest";

import { sanitizeErrorForClient } from "./error-sanitizer.js";

describe("sanitizeErrorForClient", () => {
  it("maps provider failures while logging only a stable category", () => {
    const error = Object.assign(
      new Error("OpenAI rejected Authorization: Bearer secret-token"),
      {
        cause: new Error("prompt=private concept"),
        details: { apiKey: "secret-key" },
        response: { data: { token: "response-token" }, status: 401 },
      },
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      expect(sanitizeErrorForClient(error)).toBe(
        "AI 服务暂时不可用，请稍后重试。",
      );
      expect(consoleError).toHaveBeenCalledWith(
        "[error-sanitizer] client_error_sanitized",
        { failureCategory: "provider_unavailable" },
      );

      const output = JSON.stringify(consoleError.mock.calls);
      expect(output).not.toContain("secret-token");
      expect(output).not.toContain("private concept");
      expect(output).not.toContain("response-token");
    } finally {
      consoleError.mockRestore();
    }
  });
});
