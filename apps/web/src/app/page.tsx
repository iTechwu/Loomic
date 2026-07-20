"use client";

import { FloatingNav } from "@/components/landing/floating-nav";
import { HeroSection } from "@/components/landing/hero-section";
import { TrustBar } from "@/components/landing/trust-bar";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Below-fold sections — lazy-loaded via next/dynamic to reduce initial bundle.
// Each section is its own chunk, loaded when React renders the component.
// Combined with IntersectionObserver inside motion.tsx (whileInView), these
// chunks are requested only as the user scrolls near them.
// ---------------------------------------------------------------------------

const FeatureShowcase = dynamic(
  () =>
    import("@/components/landing/feature-showcase").then(
      (m) => m.FeatureShowcase,
    ),
  { ssr: false },
);

const ShowcaseGallery = dynamic(
  () =>
    import("@/components/landing/showcase-gallery").then(
      (m) => m.ShowcaseGallery,
    ),
  { ssr: false },
);

const HowItWorks = dynamic(
  () => import("@/components/landing/how-it-works").then((m) => m.HowItWorks),
  { ssr: false },
);

const FinalCTA = dynamic(
  () => import("@/components/landing/final-cta").then((m) => m.FinalCTA),
  { ssr: false },
);

const LandingFooter = dynamic(
  () =>
    import("@/components/landing/landing-footer").then((m) => m.LandingFooter),
  { ssr: false },
);

function SignedOutNotice() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasSignedOut = searchParams.get("signed_out") === "1";
  const [visible, setVisible] = useState(hasSignedOut);

  if (!hasSignedOut || !visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-3 z-[60] mx-auto flex w-fit items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm shadow-card"
    >
      <span>已安全退出 DoFe 账户。</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="关闭退出提示"
        title="关闭退出提示"
        onClick={() => {
          setVisible(false);
          router.replace("/", { scroll: false });
        }}
      >
        <X />
      </Button>
    </div>
  );
}

export default function LandingPage() {

  return (
    <div className="relative">
      <Suspense fallback={null}>
        <SignedOutNotice />
      </Suspense>
      <FloatingNav />
      <main>
        {/* Above-fold: eagerly loaded for fast LCP */}
        <HeroSection />
        <TrustBar />

        {/* Below-fold: code-split, loaded on demand */}
        <FeatureShowcase />
        <ShowcaseGallery />
        <HowItWorks />
        <FinalCTA />
      </main>
      <LandingFooter />
    </div>
  );
}
