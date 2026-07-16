"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { beginSsoLogin } from "../lib/sso-auth";
import { Button } from "./ui/button";

export function RegisterForm() {
  const [loading, setLoading] = useState(false);

  function continueToSso() {
    setLoading(true);
    beginSsoLogin();
  }

  return (
    <div className="w-full max-w-sm space-y-6 text-center">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Create your DoFe account</h2>
        <p className="text-sm text-muted-foreground">Account registration and security settings are managed by DoFe SSO.</p>
      </motion.div>
      <Button type="button" className="w-full" disabled={loading} onClick={continueToSso}>
        {loading ? "Redirecting..." : "Continue with DoFe"}
      </Button>
    </div>
  );
}
