"use client";

import { getContentType, guessContentType, type PodEntry, parentOf } from "@mind-studio/core/solid";
import { solid } from "./client";

/**
 * Thin re-exports over the shared {@link solid} client's pod fs (see
 * `client.ts`). The POSIX-shaped LDP wrappers and content-type helpers now live
 * in `@mind-studio/core/solid`; these shims keep the app's existing import paths
 * stable. The active authed fetch (brokered shell fetch or local OIDC fetch) is
 * resolved by the shared client, so callers never wire auth themselves.
 */
export type { PodEntry };
export { getContentType, guessContentType, parentOf };

/** Public accessor for the active authed fetch (brokered or local). */
export function podFetch(): typeof fetch {
  return solid.fs.podFetch();
}

export function readdir(containerUrl: string): Promise<PodEntry[]> {
  return solid.fs.readdir(containerUrl);
}

export function readFileText(url: string): Promise<string> {
  return solid.fs.readFileText(url);
}

export function readFileBlob(url: string): Promise<Blob> {
  return solid.fs.readFileBlob(url);
}

export function writeFileText(url: string, contents: string, contentType?: string): Promise<void> {
  return solid.fs.writeFileText(url, contents, contentType);
}

export function writeFileBlob(url: string, blob: Blob, contentType?: string): Promise<string> {
  return solid.fs.writeFileBlob(url, blob, contentType);
}

export function unlink(url: string): Promise<void> {
  return solid.fs.unlink(url);
}

export function mkdir(url: string): Promise<string> {
  return solid.fs.mkdir(url);
}

export function rmrf(url: string): Promise<void> {
  return solid.fs.rmrf(url);
}

export function rename(fromUrl: string, toUrl: string, contentType?: string): Promise<void> {
  return solid.fs.rename(fromUrl, toUrl, contentType);
}
