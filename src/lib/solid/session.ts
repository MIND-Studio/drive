"use client";

import type { Session } from "@inrupt/solid-client-authn-browser";
import { solid, DEFAULT_ISSUER } from "./client";

/**
 * Thin re-exports over the shared {@link solid} client (see `client.ts`). The
 * implementation now lives in `@mind-studio/core/solid`; these shims keep the
 * app's existing import paths stable.
 */
export { DEFAULT_ISSUER };

export function session(): Session {
  return solid.session();
}

export function storedIssuer(): string {
  return solid.storedIssuer();
}

export function rememberIssuer(issuer: string): void {
  solid.rememberIssuer(issuer);
}
