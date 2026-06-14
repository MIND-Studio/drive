"use client";

import type { ISessionInfo } from "@inrupt/solid-client-authn-browser";
import { solid } from "./client";

/**
 * Thin re-exports over the shared {@link solid} client (see `client.ts`). The
 * return-to memory, embedding detection, and the single-flight
 * `handleIncomingRedirect` wrapper all live in `@mind-studio/core/solid` now;
 * these shims keep the app's existing import paths stable.
 */
export function rememberReturnTo(url: string): void {
  solid.rememberReturnTo(url);
}

export function rememberReturnToDefault(url: string): void {
  solid.rememberReturnToDefault(url);
}

export function rememberSignedOutPath(): void {
  solid.rememberSignedOutPath();
}

export function consumeReturnTo(): string {
  return solid.consumeReturnTo();
}

export function isEmbedded(): boolean {
  return solid.isEmbedded();
}

export function ensureSession(): Promise<ISessionInfo> {
  return solid.ensureSession();
}

export function completeLoginRedirect(): Promise<ISessionInfo> {
  return solid.completeLoginRedirect();
}

const EMBED_AUTOLOGIN_KEY = "mind-drive:embed-autologin";

/**
 * One-shot gate for embedded silent sign-in. App-local: this has no equivalent
 * on the shared client. When Drive is hosted in the shell the user has already
 * authenticated at the shared IdP, so we auto-start the OIDC redirect instead of
 * waiting on a "Continue" click — SSO makes the round-trip silent.
 *
 * The sessionStorage guard fires the redirect at most ONCE per tab session, so a
 * bounce-back to /connect (SSO expired, or consent declined) falls through to the
 * manual login card instead of looping.
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
