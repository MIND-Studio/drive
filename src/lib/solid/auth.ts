"use client";

import {
  handleIncomingRedirect,
  type ISessionInfo,
} from "@inrupt/solid-client-authn-browser";
import { session } from "./session";

const RETURN_TO_KEY = "mind-drive:return-to";

/**
 * The URL users should land on after the OIDC dance — set right before
 * triggering login(), read by /login/callback once the code is consumed.
 *
 * We deliberately do NOT use `restorePreviousSession: true` anywhere — CSS's
 * "silent" OIDC is in fact a full-page redirect, so calling it on every page
 * load created an infinite /login/callback ↔ /drive loop. The price we pay is
 * that a hard refresh (or deep link without an OIDC code in the URL) lands
 * users on the signed-out prompt; they click "Connect a pod" and re-auth.
 */
export function rememberReturnTo(url: string) {
  if (typeof window === "undefined") return;
  if (url.startsWith("/login/callback") || url.startsWith("/connect")) return;
  try {
    sessionStorage.setItem(RETURN_TO_KEY, url);
  } catch {}
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
