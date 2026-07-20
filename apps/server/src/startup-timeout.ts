const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;

/** Bounds startup dependencies so an orchestration health check gets a failure. */
export function withStartupTimeout<T>(
  operation: Promise<T>,
  timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Server startup timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });

  return Promise.race([operation, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}
