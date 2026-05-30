"use client";

import { useEffect, useState } from "react";
import { MindAppLauncher } from "@mind-studio/core/launcher";
import { podRootFromWebId } from "@mind-studio/core/apps";
import { ensureSession } from "@/lib/solid/auth";
import { session } from "@/lib/solid/session";

/**
 * Client wrapper for the shared app-grid launcher. Mind Drive's Masthead is a
 * server component, so this isolates the browser-only Solid session lookup.
 * Renders nothing until a pod session exists.
 */
export function LauncherButton() {
  const [webId, setWebId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void ensureSession()
      .then((info) => {
        if (alive) setWebId(info.isLoggedIn ? info.webId ?? null : null);
      })
      .catch(() => {});
  }, []);

  if (!webId) return null;

  return (
    <MindAppLauncher
      podRoot={podRootFromWebId(webId)}
      podFetch={session().fetch as typeof fetch}
      triggerClassName="grid size-7 place-items-center rounded-md text-[color:var(--ink-soft)] outline-none transition hover:text-[color:var(--accent)] focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
    />
  );
}
