"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export default function NotFound() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 文档 4.4：错误页焦点落在标题，便于辅助技术立即朗读结果。
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main
      className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center"
      role="alert"
      aria-labelledby="not-found-title"
    >
      <h1
        ref={headingRef}
        id="not-found-title"
        tabIndex={-1}
        className="text-4xl font-bold text-foreground outline-none"
      >
        404
      </h1>
      <p className="text-sm leading-6 text-muted-foreground">
        找不到该页面，它可能已被移动或删除。
      </p>
      <Link
        href="/"
        className="inline-flex h-11 min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-foreground underline underline-offset-4 hover:opacity-70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        返回首页
      </Link>
    </main>
  );
}
