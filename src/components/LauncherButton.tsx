"use client";

import { useEffect, useState } from "react";
import { MindAppLauncher } from "@mind-studio/core/launcher";
import { DEFAULT_APPS } from "@mind-studio/core/apps";
import { ensureSession } from "@/lib/solid/auth";

/**
 * Client wrapper for the shared app-grid launcher. Renders nothing until a pod
 * session exists.
 *
 * We pass the static `DEFAULT_APPS` catalog (controlled mode) instead of a
 * `podRoot`/`podFetch`, so the launcher does NOT read or seed `home/apps.ttl`
 * in the user's pod. mind-drive is a *file* app; writing the app catalog into
 * the pod is the dock's job, not ours. Self-fetch mode here only produced a
 * 404 (no catalog yet) + a failed seed-write (412) — console noise plus an
 * empty dropdown. The standard catalog is exactly what we want to show.
 */
export function LauncherButton() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let alive = true;
    void ensureSession()
      .then((info) => {
        if (alive) setSignedIn(Boolean(info.isLoggedIn && info.webId));
      })
      .catch(() => {});
  }, []);

  if (!signedIn) return null;

  return (
    <MindAppLauncher
      apps={DEFAULT_APPS}
      triggerClassName="grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}
