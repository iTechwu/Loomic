"use client";

import type { AnchorHTMLAttributes, MouseEvent } from "react";

import { beginAuthTransferFlow } from "@/lib/auth-transfer-telemetry";
import { buildSsoStartHref, rememberSsoReturnTo } from "@/lib/sso-auth";

type SsoEntryLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & {
  returnTo: string;
};

/**
 * Keeps public CTAs as native links while remembering the retry destination for
 * a same-tab SSO cancellation or recoverable callback error.
 */
export function SsoEntryLink({
  onClick,
  returnTo,
  ...props
}: SsoEntryLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      onClick?.(event);
      return;
    }
    rememberSsoReturnTo(returnTo);
    onClick?.(event);
    if (event.defaultPrevented) return;
    beginAuthTransferFlow("public");
  }

  return (
    <a {...props} href={buildSsoStartHref(returnTo)} onClick={handleClick} />
  );
}
