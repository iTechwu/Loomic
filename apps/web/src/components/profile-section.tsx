"use client";

import { useState } from "react";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface ProfileSectionProps {
  accountUrl: string | null;
  displayName: string;
  email: string;
  onSave: (displayName: string) => Promise<void>;
}

export function ProfileSection({
  accountUrl,
  displayName: initialName,
  email,
  onSave,
}: ProfileSectionProps) {
  const [displayName, setDisplayName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const hasChanges = displayName.trim() !== initialName;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) return;

    setSaving(true);
    setFeedback(null);

    try {
      await onSave(trimmed);
      setFeedback({ type: "success", message: "Profile updated." });
    } catch {
      setFeedback({
        type: "error",
        message: "Failed to update profile. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Profile</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Manage your personal information.
      </p>

      {accountUrl && (
        <a
          href={accountUrl}
          target="_blank"
          rel="noreferrer"
          className="mb-6 inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Manage account and security in DoFe SSO
        </a>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div className="space-y-2">
          <Label htmlFor="displayName">Display Name</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} disabled className="opacity-60" />
          <p className="text-xs text-muted-foreground">
            Email cannot be changed.
          </p>
        </div>

        {feedback && (
          <p
            className={`text-sm ${feedback.type === "success" ? "text-success" : "text-destructive"}`}
          >
            {feedback.message}
          </p>
        )}

        <Button type="submit" disabled={saving || !hasChanges} size="sm">
          {saving ? "Saving..." : "Save"}
        </Button>
      </form>
    </div>
  );
}
