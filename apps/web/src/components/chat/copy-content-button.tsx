"use client";

import { Check, Copy } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "../toast";

type CopyContentButtonProps = {
  content: string;
  label: string;
  disabled?: boolean;
  className?: string;
};

async function writeToClipboard(content: string): Promise<void> {
  if (window.navigator.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(content);
    return;
  }

  // Clipboard API is unavailable in some embedded or non-secure contexts.
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard fallback was rejected");
  }
}

/**
 * Compact, accessible copy action shared by each serializable chat block.
 * Clipboard logs intentionally exclude message content to avoid exposing it.
 */
export const CopyContentButton = React.memo(function CopyContentButton({
  content,
  label,
  disabled = false,
  className,
}: CopyContentButtonProps) {
  const { success, error } = useToast();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDisabled = disabled || content.length === 0;

  useEffect(
    () => () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await writeToClipboard(content);
      console.info("[chat-copy] content copied", {
        label,
        length: content.length,
      });
      setCopied(true);
      success(`${label}已复制`);

      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => setCopied(false), 2_000);
    } catch (copyError) {
      console.warn("[chat-copy] unable to copy content", {
        label,
        length: content.length,
        error: copyError,
      });
      error(`${label}复制失败，请手动选择复制`);
    }
  }, [content, error, label, success]);

  const actionLabel = copied ? `已复制${label}` : `复制${label}`;

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={isDisabled}
      aria-label={actionLabel}
      title={actionLabel}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
    >
      {copied ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
      )}
    </button>
  );
});
