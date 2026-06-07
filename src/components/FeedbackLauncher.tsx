"use client";

import { useCallback, useEffect, useState } from "react";
import { FeedbackWidget } from "@mind-studio/core/feedback";
import { feedbackInbox } from "@/lib/config";
import { ensureSession } from "@/lib/solid/auth";
import { podFetch } from "@/lib/solid/pod-fs";

/**
 * Mounts the floating 💬 feedback widget on every standalone Drive page. Bridges
 * Drive's broker-aware session to the storage-agnostic widget:
 *
 * - `webId` comes from `ensureSession()` (null until resolved → anonymous submit,
 *   which the public-append inbox accepts).
 * - `fetch` delegates to `podFetch()` *per call* rather than capturing it once,
 *   so the right transport is used after the shell broker (if any) initialises.
 */
export function FeedbackLauncher() {
  const [webId, setWebId] = useState<string | null>(null);

  useEffect(() => {
    ensureSession()
      .then((info) => setWebId(info.webId ?? null))
      .catch(() => setWebId(null));
  }, []);

  // Resolve the transport lazily on each request — isBrokered() flips once the
  // shell answers, and a fetch captured at mount would miss the broker tunnel.
  const fetcher = useCallback<typeof fetch>((...args) => podFetch()(...args), []);

  return (
    <FeedbackWidget
      appKey="drive"
      inbox={feedbackInbox}
      fetch={fetcher}
      webId={webId}
      variant="floating"
    />
  );
}
