"use client";

import { Button, useMindTheme } from "@mind-studio/ui";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Light/dark switch backed by the @mind-studio/ui ThemeProvider (next-themes
 * under the hood). We gate on a mounted flag so the icon doesn't flash the
 * wrong glyph during hydration — `resolvedMode` is only correct client-side.
 */
export default function ThemeToggle() {
  const { resolvedMode, setMode } = useMindTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Gate *everything* theme-dependent on `mounted` so the hydration render
  // matches the server (which has no resolved theme): both produce the
  // `isDark === false` branch. After mount we re-render with the real value.
  // Gating only the icon (not aria-label/title) caused a hydration mismatch.
  const isDark = mounted && resolvedMode === "dark";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setMode(isDark ? "light" : "dark")}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={`Switch to ${isDark ? "light" : "dark"} theme`}
      data-testid="theme-toggle"
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
