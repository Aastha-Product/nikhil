"use client";

// While research is queued or running, re-fetch the page every few seconds so status updates appear.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({ active, intervalMs = 8000 }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}
