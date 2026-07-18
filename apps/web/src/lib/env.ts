const defaultServerBaseUrl = "http://localhost:3105";

export function getServerBaseUrl() {
  // Must access process.env.NEXT_PUBLIC_* directly — webpack DefinePlugin
  // only replaces direct references, not indirect access via a variable.
  const configuredUrl = normalizeServerBaseUrl(
    process.env.NEXT_PUBLIC_SERVER_BASE_URL,
  );
  if (configuredUrl) return configuredUrl;

  // The static web app and API are served from one host in every deployed
  // environment. Resolving the browser origin avoids baking CI URLs into a
  // production image, while localhost keeps the direct local API fallback.
  if (
    typeof window !== "undefined" &&
    !isLocalDevelopmentHost(window.location.hostname)
  ) {
    return window.location.origin;
  }

  return defaultServerBaseUrl;
}

function normalizeServerBaseUrl(value: string | undefined): string | null {
  const url = value?.trim().replace(/\/+$/, "");
  if (!url) return null;
  return url.replace(/\/api$/, "");
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export type WebEnv = {
  serverBaseUrl: string;
};

export function loadWebEnv(overrides: Partial<WebEnv> = {}): WebEnv {
  return {
    serverBaseUrl: overrides.serverBaseUrl ?? getServerBaseUrl(),
  };
}
