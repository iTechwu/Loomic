"use client";

import { useEffect } from "react";

import { beginSsoLogin } from "@/lib/sso-auth";

/**
 * Last-resort compatibility for static previews without the production proxy.
 * Nginx and Vercel redirect these routes before this component can load.
 */
export function LegacySsoRedirect() {
  useEffect(() => {
    beginSsoLogin("/home", "public");
  }, []);

  return null;
}
