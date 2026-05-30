"use client";

import {
  getSolidDataset,
  getContainedResourceUrlAll,
  getThing,
  getDatetime,
  getInteger,
  deleteFile,
  deleteContainer,
  overwriteFile,
  getFile,
  createContainerAt,
  getSourceUrl,
  getContentType,
} from "@inrupt/solid-client";
import { session } from "./session";

/**
 * POSIX-shaped wrappers around the Solid LDP HTTP API, ported from
 * mind-os-v0. Drive UI components and the indexer both call through here.
 *
 * Limits we accept (Solid-protocol-level, not ours to fix):
 *   - LDP PUT replaces the whole resource. Write is whole-file only.
 *   - No native move / rename. Use `move` here = copy + unlink.
 *   - `deleteContainer` errors if non-empty; `rmrf` walks the tree first.
 *   - readdir() is one level deep.
 */

export type PodEntry = {
  url: string;
  name: string;
  kind: "container" | "resource";
  modified?: Date;
  /** Server-reported size in bytes if exposed via posix:size; else undefined. */
  size?: number;
  /** Server-reported content type if exposed via the description resource. */
  contentType?: string;
};

function authedFetch(): typeof fetch {
  return session().fetch as typeof fetch;
}

function ensureSlash(u: string) {
  return u.endsWith("/") ? u : u + "/";
}

function basename(url: string, parent: string): string {
  const tail = url.slice(parent.length);
  if (tail.endsWith("/")) return tail.slice(0, -1);
  return tail;
}

/**
 * Wrap the authenticated fetch with `cache: 'no-store'` so CSS containment
 * triples aren't served from the browser cache after a write. Without this,
 * readdir() right after mkdir/upload/delete will see stale listings.
 */
function noCacheFetch(): typeof fetch {
  const inner = session().fetch as typeof fetch;
  return ((url: RequestInfo | URL, init?: RequestInit) =>
    inner(url, { ...init, cache: "no-store" })) as typeof fetch;
}

export async function readdir(containerUrl: string): Promise<PodEntry[]> {
  const parent = ensureSlash(containerUrl);
  const dataset = await getSolidDataset(parent, { fetch: noCacheFetch() });
  const urls = getContainedResourceUrlAll(dataset);
  return urls
    .map((url): PodEntry => {
      const isContainer = url.endsWith("/");
      const thing = getThing(dataset, url);
      const modified = thing
        ? getDatetime(thing, "http://purl.org/dc/terms/modified") ?? undefined
        : undefined;
      const size = thing
        ? getInteger(thing, "http://www.w3.org/ns/posix/stat#size") ?? undefined
        : undefined;
      return {
        url,
        name: basename(url, parent),
        kind: isContainer ? "container" : "resource",
        modified: modified ?? undefined,
        size: size ?? undefined,
      };
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "container" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export async function readFileText(url: string): Promise<string> {
  const blob = await getFile(url, { fetch: authedFetch() });
  return await blob.text();
}

export async function readFileBlob(url: string): Promise<Blob> {
  return await getFile(url, { fetch: authedFetch() });
}

export async function writeFileText(
  url: string,
  contents: string,
  contentType = "text/plain"
): Promise<void> {
  await overwriteFile(url, new Blob([contents], { type: contentType }), {
    contentType,
    fetch: authedFetch(),
  });
}

export async function writeFileBlob(
  url: string,
  blob: Blob,
  contentType?: string
): Promise<string> {
  const type = contentType ?? blob.type ?? "application/octet-stream";
  const result = await overwriteFile(url, blob, {
    contentType: type,
    fetch: authedFetch(),
  });
  return getSourceUrl(result) ?? url;
}

export async function unlink(url: string): Promise<void> {
  if (url.endsWith("/")) {
    await deleteContainer(url, { fetch: authedFetch() });
  } else {
    await deleteFile(url, { fetch: authedFetch() });
  }
}

export async function mkdir(url: string): Promise<string> {
  const target = ensureSlash(url);
  const result = await createContainerAt(target, { fetch: authedFetch() });
  return getSourceUrl(result) ?? target;
}

/**
 * Recursive delete. LDP `deleteContainer` returns 409 if the container is
 * not empty, so we depth-first delete every descendant first.
 */
export async function rmrf(url: string): Promise<void> {
  if (!url.endsWith("/")) {
    await unlink(url);
    return;
  }
  const entries = await readdir(url);
  for (const entry of entries) {
    await rmrf(entry.url);
  }
  await unlink(url);
}

/**
 * Best-effort rename. LDP has no atomic move, so this is copy + delete.
 * ACLs do not follow — caller must re-apply if needed.
 */
export async function rename(
  fromUrl: string,
  toUrl: string,
  contentType?: string
): Promise<void> {
  if (fromUrl === toUrl) return;
  if (fromUrl.endsWith("/")) {
    throw new Error("rename: container rename not implemented in M1");
  }
  const blob = await readFileBlob(fromUrl);
  const type =
    contentType ?? (blob.type || guessContentType(fromUrl));
  await writeFileBlob(toUrl, blob, type);
  await unlink(fromUrl);
}

export function guessContentType(nameOrUrl: string): string {
  const lower = nameOrUrl.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".js")) return "application/javascript";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

export function parentOf(url: string, root: string): string | null {
  if (url === root) return null;
  const stripped = url.endsWith("/") ? url.slice(0, -1) : url;
  const i = stripped.lastIndexOf("/");
  if (i < 0) return null;
  const parent = stripped.slice(0, i + 1);
  if (!parent.startsWith(root)) return root;
  return parent;
}

export { getContentType };
