/**
 * Emits operational failures without accepting arbitrary context. Business
 * callers must use stable categories rather than serializing user, resource,
 * provider, or database values into application logs.
 */
export function logOperationalFailure(
  event: string,
  failureCategory: string,
): void {
  console.error(event, { failureCategory });
}

export function logOperationalWarning(
  event: string,
  failureCategory: string,
): void {
  console.warn(event, { failureCategory });
}
