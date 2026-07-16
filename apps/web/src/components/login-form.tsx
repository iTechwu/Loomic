"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { beginSsoLogin } from "../lib/sso-auth";
import { Button } from "./ui/button";

const fadeIn = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
} as const;

interface LoginFormProps {
  initialErrorMessage?: string | null;
  returnTo?: string;
}

export function LoginForm({ initialErrorMessage = null, returnTo = "/home" }: LoginFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialErrorMessage);
  const started = useRef(false);

  const handleSignIn = useCallback(() => {
    setLoading(true);
    setError(null);
    beginSsoLogin(returnTo);
  }, [returnTo]);

  useEffect(() => {
    if (started.current || initialErrorMessage) return;
    started.current = true;
    handleSignIn();
  }, [handleSignIn, initialErrorMessage]);

  return (
    <div className="w-full max-w-sm space-y-6">
      <motion.div variants={fadeIn} initial="hidden" animate="visible" className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Continue with DoFe</h2>
        <p className="text-sm text-muted-foreground">Use your shared DoFe account to open your workspace.</p>
      </motion.div>
      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>}
      <motion.div variants={fadeIn} initial="hidden" animate="visible">
        <Button type="button" className="w-full" disabled={loading} onClick={handleSignIn}>
          {loading ? "Redirecting..." : "Continue with DoFe"}
        </Button>
      </motion.div>
    </div>
  );
}
