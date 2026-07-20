"use client";

import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { AuthProvider } from "../lib/auth-context";
import { getBrowserSsoUiLocale } from "../lib/sso-auth";
import { ToastProvider } from "./toast";

function DocumentLocaleSync() {
  useEffect(() => {
    document.documentElement.lang = getBrowserSsoUiLocale();
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <DocumentLocaleSync />
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}
