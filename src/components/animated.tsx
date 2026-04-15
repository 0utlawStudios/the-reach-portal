"use client";

import { useState, useEffect, useRef } from "react";

// ─── Animated Counter: counts from 0 to target (no flash-to-zero) ───
export function AnimatedCounter({ value, duration = 700, suffix = "", prefix = "", className = "" }: {
  value: number;
  duration?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const frameRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const fromRef = useRef(0);
  const displayRef = useRef(value);
  const initialRender = useRef(true);

  useEffect(() => {
    // On first render, animate from 0. On subsequent, animate from current.
    if (initialRender.current) {
      fromRef.current = 0;
      initialRender.current = false;
    } else {
      fromRef.current = displayRef.current;
    }
    startRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const next = Math.round(fromRef.current + (value - fromRef.current) * eased);
      displayRef.current = next;
      setDisplay(next);
      if (progress < 1) frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  return <span className={className}>{prefix}{display}{suffix}</span>;
}

// ─── Animated Bar: fills from 0 to target width (CSS transition, no reset) ───
export function AnimatedBar({ width, color, delay = 0, duration = 600, className = "" }: {
  width: number;
  color: string;
  delay?: number;
  duration?: number;
  className?: string;
}) {
  const [currentWidth, setCurrentWidth] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentWidth(width);
    }, delay);
    return () => clearTimeout(timer);
  }, [width, delay]);

  return (
    <div
      className={`h-full rounded-full ${className}`}
      style={{
        width: `${Math.max(currentWidth, 0)}%`,
        background: color,
        transition: `width ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`,
      }}
    />
  );
}

// ─── Stagger wrapper: delays children mount ───
export function StaggerIn({ children, delay = 0, className = "" }: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 300ms ease-out, transform 300ms ease-out",
      }}
    >
      {children}
    </div>
  );
}

// ─── Animated progress ring ───
export function AnimatedRing({ percentage, duration = 800, className = "" }: {
  percentage: number;
  duration?: number;
  className?: string;
}) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setCurrent(percentage), 50);
    return () => clearTimeout(timer);
  }, [percentage]);

  return (
    <div
      className={className}
      style={{
        strokeDashoffset: `${238.76 * (1 - current / 100)}`,
        transition: `stroke-dashoffset ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`,
      }}
    />
  );
}
