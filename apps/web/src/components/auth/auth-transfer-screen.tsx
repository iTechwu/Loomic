"use client";

import { useEffect, useRef } from "react";

import { LovartDofeLogo } from "@/components/icons/lovart-dofe-logo";
import { Button } from "@/components/ui/button";

export type AuthTransferError =
  | "cancelled"
  | "callback_invalid"
  | "exchange_failed"
  | "viewer_bootstrap_failed"
  | "timeout";

const ERROR_COPY: Record<AuthTransferError, string> = {
  callback_invalid: "登录信息不完整或已失效，请重新开始。",
  cancelled: "你已取消 DoFe 账户授权。",
  exchange_failed: "DoFe 无法验证此次授权，请重新开始。",
  timeout: "身份验证耗时过长，请重新开始。",
  viewer_bootstrap_failed: "账户已验证，但工作区暂时无法打开。",
};

export function AuthTransferScreen({
  error,
  onRetry,
  supportId,
}: {
  error?: AuthTransferError;
  onRetry?: () => void;
  supportId?: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (error) headingRef.current?.focus();
  }, [error]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
        <section
          className="w-full max-w-sm space-y-6 text-center"
          role="alert"
          aria-labelledby="auth-transfer-error-title"
        >
          <LovartDofeLogo className="mx-auto size-10 text-foreground" />
          <div className="space-y-2">
            <h1
              ref={headingRef}
              id="auth-transfer-error-title"
              tabIndex={-1}
              className="text-xl font-semibold outline-none"
            >
              无法完成 DoFe 账户授权
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {ERROR_COPY[error]}
            </p>
            {supportId ? (
              <p className="font-mono text-xs text-muted-foreground">
                支持编号：{supportId}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <Button type="button" className="h-10 w-full" onClick={onRetry}>
              重新开始
            </Button>
            <a
              href="/"
              className="inline-flex h-10 items-center justify-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              返回首页
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-6 py-12"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <LovartDofeLogo className="size-10 text-foreground" />
        <div className="space-y-1">
          <h1 className="text-base font-semibold">正在验证 DoFe 账户</h1>
          <p className="text-sm text-muted-foreground">请稍候，正在打开你的工作区。</p>
        </div>
      </div>
    </main>
  );
}
