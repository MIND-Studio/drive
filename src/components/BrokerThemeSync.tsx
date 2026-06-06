"use client";

import { useEffect } from "react";
import { useMindTheme } from "@mind-studio/ui";
import { currentBrokeredTheme, subscribeBrokeredTheme } from "@/lib/solid/broker";

/**
 * When Drive runs inside the Mind shell, the shell hands its color mode over the
 * capability bridge (`mind:welcome { theme }`). This component applies that theme
 * to Drive's own ThemeProvider so the embedded chrome matches the shell instead
 * of falling back to Drive's `dark` default — and tracks live shell theme toggles
 * (the shell re-broadcasts welcome on change).
 *
 * Standalone, no theme is ever brokered, so this is a no-op and Drive keeps its
 * own theme (default + user toggle). Renders nothing.
 */
export function BrokerThemeSync() {
  const { setMode } = useMindTheme();

  useEffect(() => {
    const apply = () => {
      const t = currentBrokeredTheme();
      if (t) setMode(t);
    };
    apply(); // in case the welcome arrived before this mounted
    return subscribeBrokeredTheme(apply);
  }, [setMode]);

  return null;
}
