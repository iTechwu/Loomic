/**
 * Sanitize error messages before sending to the frontend.
 * Emits only a stable failure category server-side and returns a user-friendly
 * message. Provider errors may carry prompt fragments, credentials, or bodies.
 */

const PROVIDER_PATTERN =
  /google|vertex|openai|replicate|langchain|gaxios|undici|fetch failed/i;
const DB_PATTERN = /postgres|database|relation|column|constraint/i;
const AUTH_PATTERN =
  /jwt|token|unauthorized|forbidden|credential|service.account/i;
const INFRA_PATTERN =
  /econnrefused|econnreset|etimedout|dns|socket|tls|certificate/i;
const MODEL_UNAVAILABLE_PATTERN = /model not found|unknown model|model.*(?:unavailable|not available)/i;

export function sanitizeErrorForClient(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  const result = clientErrorResult(raw);
  console.error("[error-sanitizer] client_error_sanitized", {
    failureCategory: result.failureCategory,
  });
  return result.message;
}

function clientErrorResult(raw: string): {
  failureCategory: string;
  message: string;
} {
  if (MODEL_UNAVAILABLE_PATTERN.test(raw)) {
    return {
      failureCategory: "model_unavailable",
      message: "所选模型当前不可用，请切换模型后重试。",
    };
  }
  if (PROVIDER_PATTERN.test(raw)) {
    return {
      failureCategory: "provider_unavailable",
      message: "AI 服务暂时不可用，请稍后重试。",
    };
  }
  if (DB_PATTERN.test(raw)) {
    return {
      failureCategory: "database_unavailable",
      message: "数据服务异常，请稍后重试。",
    };
  }
  if (AUTH_PATTERN.test(raw)) {
    return {
      failureCategory: "authentication_failed",
      message: "认证失败，请刷新页面重新登录。",
    };
  }
  if (INFRA_PATTERN.test(raw)) {
    return {
      failureCategory: "infrastructure_unavailable",
      message: "网络连接异常，请检查网络后重试。",
    };
  }
  if (raw.includes("abort") || raw.includes("cancel")) {
    return { failureCategory: "request_cancelled", message: "请求已取消。" };
  }
  return {
    failureCategory: "request_failed",
    message: "请求处理失败，请重试。",
  };
}
