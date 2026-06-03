"use client";

import { useEffect, useState } from "react";
import { session } from "@/lib/solid/session";

/**
 * Inline thumbnail for an image file in the user's pod. Fetches with the
 * authenticated session, holds the bytes as an object URL, and revokes on
 * unmount. For v0 we render the full image at thumbnail size — proper
 * decode-and-rescale-in-worker comes when the demo files are bigger than
 * a few MB.
 */
export function ImageThumbnail({
  url,
  alt,
  className,
}: {
  url: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const res = await session().fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (error) {
    return (
      <span
        className={`inline-flex items-center justify-center bg-muted font-mono text-[10px] uppercase text-muted-foreground ${className ?? ""}`}
        aria-hidden="true"
      >
        img
      </span>
    );
  }

  if (!src) {
    return (
      <span
        className={`inline-flex items-center justify-center bg-muted ${className ?? ""}`}
        aria-hidden="true"
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      className={`object-cover ${className ?? ""}`}
      loading="lazy"
    />
  );
}

export function isImageName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".svg")
  );
}
