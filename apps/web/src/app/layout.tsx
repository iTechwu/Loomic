import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";

import { Providers } from "../components/providers";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://lovart.dofe.ai"),
  title: "lovart.dofe",
  description: "DoFe 统一账户支持的 AI 创意工作区",
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "lovart.dofe",
    description: "DoFe 统一账户支持的 AI 创意工作区",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "lovart.dofe",
    description: "DoFe 统一账户支持的 AI 创意工作区",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className="scroll-smooth overflow-x-hidden"
      suppressHydrationWarning
    >
      <body className="min-h-screen overflow-x-hidden bg-background font-sans antialiased">
        <Providers>{children}</Providers>
        <Script
          src="https://app.lemonsqueezy.com/js/lemon.js"
          strategy="lazyOnload"
        />
      </body>
    </html>
  );
}
