"use client";

import { isEmbedded } from "@/lib/solid/auth";

/**
 * Save a Blob to the user's device. Standalone, this is the usual
 * create-anchor-and-click. But inside the Mind shell, Drive runs in a
 * sandboxed iframe where `<a download>` is silently blocked (no
 * `allow-downloads`) — the click does nothing and the file never saves. There
 * we open the blob in a new top-level tab instead, which escapes the sandbox so
 * the user can view/save it. The object URL is revoked on a delay so the new
 * tab has time to load it.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  if (isEmbedded()) {
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
