"use client";

import { cn } from "@/lib/utils";
import { useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// useTypewriter hook
// ---------------------------------------------------------------------------

interface UseTypewriterOptions {
  text: string;
  /** Milliseconds per character (default: 50) */
  speed?: number | undefined;
  /** Delay in ms before animation starts (default: 0) */
  delay?: number | undefined;
}

interface UseTypewriterReturn {
  displayText: string;
  isComplete: boolean;
  cursor: boolean;
}

export function useTypewriter({
  text,
  speed = 50,
  delay = 0,
}: UseTypewriterOptions): UseTypewriterReturn {
  const shouldReduce = useReducedMotion();
  const reduceMotion = shouldReduce === true;
  const [displayText, setDisplayText] = useState(reduceMotion ? text : "");
  const [isComplete, setIsComplete] = useState(reduceMotion);
  const [cursor, setCursor] = useState(true);
  const indexRef = useRef(0);

  // Typing effect
  useEffect(() => {
    if (reduceMotion) {
      setDisplayText(text);
      setIsComplete(true);
      return;
    }

    // Reset on text change
    indexRef.current = 0;
    setDisplayText("");
    setIsComplete(false);

    let typingInterval: ReturnType<typeof setInterval> | undefined;

    const startTimeout = setTimeout(() => {
      typingInterval = setInterval(() => {
        const next = indexRef.current + 1;
        setDisplayText(text.slice(0, next));
        indexRef.current = next;

        if (next >= text.length) {
          clearInterval(typingInterval);
          setIsComplete(true);
        }
      }, speed);
    }, delay);

    return () => {
      clearTimeout(startTimeout);
      if (typingInterval) clearInterval(typingInterval);
    };
  }, [text, speed, delay, reduceMotion]);

  // A blinking caret is non-essential motion. Keep the final text readable
  // without an interval when the user asks to reduce motion.
  useEffect(() => {
    if (reduceMotion || isComplete) {
      setCursor(false);
      return;
    }
    const blink = setInterval(() => {
      setCursor((v) => !v);
    }, 530);
    return () => clearInterval(blink);
  }, [isComplete, reduceMotion]);

  return { displayText, isComplete, cursor };
}

// ---------------------------------------------------------------------------
// TypewriterText component
// ---------------------------------------------------------------------------

interface TypewriterTextProps {
  text: string;
  speed?: number;
  delay?: number;
  className?: string;
  cursorClassName?: string;
}

export function TypewriterText({
  text,
  speed,
  delay,
  className,
  cursorClassName,
}: TypewriterTextProps) {
  const { displayText, cursor } = useTypewriter({ text, speed, delay });

  return (
    <span className={cn("inline", className)}>
      {displayText}
      <span
        aria-hidden="true"
        className={cn(
          "inline-block w-[2px] h-[1em] align-middle ml-[1px] bg-current",
          "transition-opacity duration-100",
          cursor ? "opacity-100" : "opacity-0",
          cursorClassName,
        )}
      />
    </span>
  );
}
