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
      setFeedback({ type: "success", message: "资料已更新。" });
    } catch {
      setFeedback({
        type: "error",
        message: "更新资料失败，请重试。",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">个人资料</h2>
      <p className="text-sm text-muted-foreground mb-6">
        管理你的个人信息。
      </p>

      {accountUrl && (
        <a
          href={accountUrl}
          target="_blank"
          rel="noreferrer"
          className="mb-6 inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          在 DoFe 账户中心管理账户与安全
        </a>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div className="space-y-2">
          <Label htmlFor="displayName">显示名称</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="你的名称"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input id="email" value={email} disabled className="opacity-60" />
          <p className="text-xs text-muted-foreground">
            邮箱无法在此更改。
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
          {saving ? "保存中…" : "保存"}
        </Button>
      </form>
    </div>
  );
}
