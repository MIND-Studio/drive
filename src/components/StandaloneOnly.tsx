"use client";

import { useEffect, useState } from "react";
import { initBroker, isBrokered } from "@/lib/solid/broker";

/**
 * Renders its children only when Drive runs **standalone**. Inside the Mind shell
 * (brokered mode) it renders nothing — the shell already provides the chrome
 * (app title, navigation, app launcher, theme), so Drive's own masthead/colophon
 * would be redundant duplicate chrome inside the shell's app body.
 *
 * Detection is the broker handshake: if a Mind shell answers, hide. Any flash of
 * the masthead during the ~handshake window is covered by the shell's loading
 * overlay (it clears on `mind:ready`, which Drive fires only after this resolves).
 */
export function StandaloneOnly({ children }: { children: React.ReactNode }) {
  const [embedded, setEmbedded] = useState(false);

  useEffect(() => {
    if (isBrokered()) {
      setEmbedded(true);
      return;
    }
    let alive = true;
    initBroker().then((id) => {
      if (alive && id) setEmbedded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (embedded) return null;
  return <>{children}</>;
}
