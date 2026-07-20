"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";

import { AuthProvider } from "../lib/auth-context";
import { ToastProvider } from "./toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}
