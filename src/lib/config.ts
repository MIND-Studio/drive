/**
 * Single source of truth for pod URLs. Every Solid call in this prototype
 * flows through here, so flipping to a shared CSS instance is one env var.
 */
export const POD_BASE_URL = process.env.NEXT_PUBLIC_POD_BASE_URL ?? "http://localhost:3011/";

/**
 * The namespace mind-drive claims under each user's pod. Sibling prototypes
 * claim their own (`mind-market`, `mind-social`, …) so a shared-CSS scenario
 * has no collisions.
 */
export const DRIVE_NAMESPACE = process.env.NEXT_PUBLIC_DRIVE_NAMESPACE ?? "mind-drive";

/**
 * App-owned feedback inbox (a public-append container the app developer
 * controls). All feedback — from any user, logged in or not — is POSTed here,
 * and the dev reads it from this one place via `/feedback`. Element-targeted
 * feedback rides on the same record. See `@mind-studio/core/feedback`.
 */
export const feedbackInbox =
  process.env.NEXT_PUBLIC_FEEDBACK_INBOX ??
  `${POD_BASE_URL.endsWith("/") ? POD_BASE_URL : POD_BASE_URL + "/"}alice/drive-feedback/`;

/** `https://alice.pod/mind-drive/files/` — the user's drive root container. */
export function driveRootFor(podRoot: string): string {
  const root = podRoot.endsWith("/") ? podRoot : podRoot + "/";
  return `${root}${DRIVE_NAMESPACE}/files/`;
}

/**
 * Re-encode a path segment so that double-encoded input (`foo%2520bar`) and
 * decoded input (`foo bar`) both collapse to the canonical single-encoded
 * form (`foo%20bar`). Next.js 16 hands catch-all params back already
 * URL-encoded; running `encodeURIComponent` on them again was producing
 * `%2520` and breaking pod fetches for filenames with spaces/commas/etc.
 *
 * Idempotent for already-correct segments. Falls back to the input if a
 * malformed `%xx` sequence makes decodeURIComponent throw.
 */
export function normalizeSegment(seg: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(seg));
  } catch {
    return seg;
  }
}

/**
 * Given a WebID like `http://localhost:3061/alice/profile/card#me`, return
 * the pod root `http://localhost:3061/alice/`. CSS layouts vary across
 * providers; for the demo we assume the WebID lives one level under the pod.
 */
export function podRootFromWebId(webId: string): string {
  const url = new URL(webId);
  url.hash = "";
  url.search = "";
  const parts = url.pathname.split("/").filter(Boolean);
  // profile/card → drop the last two segments to get the pod root path
  if (parts.length >= 2 && parts[parts.length - 1].startsWith("card")) {
    parts.pop();
    parts.pop();
  }
  url.pathname = "/" + parts.join("/") + (parts.length ? "/" : "");
  return url.toString();
}
