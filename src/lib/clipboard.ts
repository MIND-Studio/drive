"use client";

/**
 * Copy text to the clipboard, resilient to the embedding frame's permissions
 * policy. Inside the Mind shell, Drive runs in an iframe where the async
 * Clipboard API (`navigator.clipboard.writeText`) is blocked by a
 * `clipboard-write` permissions policy and throws NotAllowedError. The legacy
 * `document.execCommand("copy")` path is NOT gated by that policy, so we fall
 * back to it. Returns false only when both paths fail — callers should then
 * leave the text selected for a manual copy.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* clipboard API blocked by the frame — fall through to execCommand */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
