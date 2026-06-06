"use client";

import {
  handleIncomingRedirect,
  type ISessionInfo,
} from "@inrupt/solid-client-authn-browser";
import { session } from "./session";
import { initBroker } from "./broker";

const RETURN_TO_KEY = "mind-drive:return-to";

/**
 * The URL users should land on after the OIDC dance — set right before
 * triggering login(), read by /login/callback once the code is consumed.
 *
 * We deliberately do NOT use `restorePreviousSession: true` anywhere. In the
 * @inrupt browser SDK that flag is not a token-based silent restore — it is a
 * full-page redirect to the IdP. On CSS, calling it on every page load created
 * an infinite /login/callback ↔ /drive loop (verified again 2026-06-01), and
 * even in the happy path it round-trips through the IdP and discards the deep
 * link. The price is that a hard refresh (or deep link without an OIDC code in
 * the URL) lands on the signed-out prompt. We soften that by remembering the
 * attempted path (see `rememberSignedOutPath`) so reconnecting returns there.
 */
export function rememberReturnTo(url: string) {
  if (typeof window === "undefined") return;
  if (url.startsWith("/login/callback") || url.startsWith("/connect")) return;
  try {
    sessionStorage.setItem(RETURN_TO_KEY, url);
  } catch {}
}

/**
 * Set the post-login destination ONLY if one isn't already remembered. The
 * signed-out view on a deep link (e.g. /drive/file/foo) records that path; the
 * /connect form then uses this to fall back to /drive without clobbering it,
 * so the user returns to the file they actually wanted.
 */
export function rememberReturnToDefault(url: string) {
  if (typeof window === "undefined") return;
  try {
    if (!sessionStorage.getItem(RETURN_TO_KEY)) rememberReturnTo(url);
  } catch {}
}

/**
 * Called by signed-out screens on mount to capture where the user was trying
 * to go, so a subsequent "Connect a pod" → login returns them there.
 */
export function rememberSignedOutPath() {
  if (typeof window === "undefined") return;
  rememberReturnTo(window.location.pathname + window.location.search);
}

export function consumeReturnTo(): string {
  if (typeof window === "undefined") return "/drive";
  try {
    const v = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    if (v && v.startsWith("/") && !v.startsWith("//")) return v;
  } catch {}
  return "/drive";
}

const EMBED_AUTOLOGIN_KEY = "mind-drive:embed-autologin";

/**
 * True when Drive is running inside another origin's frame (e.g. the Mind
 * shell's app body). A cross-origin parent makes `window.top` access throw,
 * which is itself proof we're framed.
 */
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * One-shot gate for embedded silent sign-in. When Drive is hosted in the shell
 * the user has already authenticated at the shared IdP (pod.mindpods.org), so
 * we auto-start the OIDC redirect instead of waiting on a "Continue" click —
 * SSO makes the round-trip silent (no password prompt).
 *
 * We deliberately DON'T use the @inrupt `restorePreviousSession` silent path:
 * it loops `/login/callback ↔ /drive` here (see the note above). Instead this
 * fires the same redirect the button does, but at most ONCE per tab session —
 * the sessionStorage guard means a bounce-back to /connect (SSO expired, or
 * consent declined) falls through to the manual login card instead of looping.
 */
export function shouldAutoLoginEmbedded(): boolean {
  if (!isEmbedded()) return false;
  try {
    if (sessionStorage.getItem(EMBED_AUTOLOGIN_KEY)) return false;
    sessionStorage.setItem(EMBED_AUTOLOGIN_KEY, "1");
  } catch {
    return false;
  }
  return true;
}

/**
 * Single-flight wrapper around `handleIncomingRedirect`. The OIDC authorization
 * code is one-time-use: redeeming it twice makes the token endpoint return
 * `invalid_grant`, which resets the @inrupt session back to signed-out. That is
 * exactly what happened in prod — the `/login/callback` page redeemed the code,
 * but `LauncherButton` (mounted in the root layout, so present on the callback
 * route too) fired its own `ensureSession()` concurrently and redeemed the same
 * code a second time. Whichever call lost the race wiped the session, so users
 * landed on the signed-out "Connect your pod" prompt nondeterministically.
 *
 * Memoizing the call to a module-level promise guarantees the redirect is
 * handled exactly once per page load no matter how many components ask for the
 * session, so the code is redeemed once and the resulting session sticks.
 */
let redirectHandled: Promise<void> | null = null;

function handleRedirectOnce(): Promise<void> {
  if (!redirectHandled) {
    redirectHandled = handleIncomingRedirect({
      url: typeof window !== "undefined" ? window.location.href : undefined,
    })
      .then(() => undefined)
      // Swallow: a stale/replayed code rejects here, but the first (winning)
      // call already established the session. Callers re-read session().info.
      .catch(() => undefined);
  }
  return redirectHandled;
}

/**
 * Idempotent session check on page load. Consumes an OIDC code if the URL has
 * one (from a fresh redirect), but does NOT trigger silent re-auth. Returns
 * the current session info — caller is responsible for handling signed-out.
 */
export async function ensureSession(): Promise<ISessionInfo> {
  const s = session();
  if (s.info.isLoggedIn) return s.info;
  // Inside the Mind shell, take identity over the capability bridge instead of
  // running our own OIDC — the shell brokers all pod I/O (see broker.ts), so no
  // credential crosses and the app's own sign-in screen is skipped entirely.
  // Falls through to the normal redirect flow if no shell answers (foreign
  // embed / standalone), keeping Drive unchanged outside the shell.
  if (isEmbedded()) {
    const brokered = await initBroker();
    if (brokered) {
      return {
        isLoggedIn: true,
        webId: brokered.webId,
        sessionId: "mind-shell-brokered",
      } as ISessionInfo;
    }
  }
  await handleRedirectOnce();
  return session().info;
}

/**
 * Completes the OIDC redirect on the /login/callback route. Shares the same
 * single-flight redemption as `ensureSession`, so the callback page and any
 * concurrently-mounted component (e.g. the layout's launcher) never redeem the
 * code twice. Returns the session info so the caller can route accordingly.
 */
export async function completeLoginRedirect(): Promise<ISessionInfo> {
  await handleRedirectOnce();
  return session().info;
}
