"use client";

import { session } from "./session";
import { podRootFromWebId } from "@/lib/config";

/**
 * Brokered identity + pod I/O for when Mind Drive runs *inside* the Mind shell.
 *
 * The shell (mind-shell-v0) hosts Drive in a sandboxed iframe and exposes a
 * versioned postMessage "capability bridge" (PRD-APPS §5): it hands the child
 * the signed-in identity (webId + workspace pod root) and performs every pod
 * request on the child's behalf with ITS authed fetch — scope-checked to the
 * workspace pod root. The child never receives a credential and never runs OIDC.
 *
 * This module is the Drive-side client for that bridge. When Drive detects it
 * is framed, it does the handshake (`mind:hello` → `mind:welcome`) and, on
 * success, flips into *brokered* mode: {@link currentIdentity} returns the
 * shell's webId / pod root and {@link brokerFetch} tunnels `fetch()` over
 * postMessage so all of `pod-fs.ts` transparently talks to the pod through the
 * shell. The result: opening Drive in the shell lands on your files with NO
 * sign-in screen — the app's own login is obsolete inside the shell.
 *
 * If no Mind shell answers the handshake within {@link HANDSHAKE_TIMEOUT_MS}
 * (a foreign embedder, or standalone), {@link initBroker} resolves `null` and
 * Drive falls back to its own OIDC sign-in. Nothing here changes standalone
 * Drive — `isBrokered()` stays false and every fetch uses `session().fetch`.
 *
 * Privacy: only identifiers (webId, pod root) ever cross the boundary; the
 * shell's credential never does. Request/response bodies are base64-framed when
 * binary so uploads, downloads, and image thumbnails survive the tunnel intact.
 */

const PROTOCOL_VERSION = 1 as const;
const HANDSHAKE_TIMEOUT_MS = 1500;
const HELLO_RETRY_MS = 150;
const FETCH_TIMEOUT_MS = 30_000;

export interface BrokerIdentity {
  webId: string;
  /** Workspace pod root, trailing-slashed — Drive's pod root inside the shell. */
  podRoot: string;
}

/** The shell's color mode, handed over the bridge so Drive's chrome matches it. */
export type BrokerTheme = "light" | "dark";

let brokered: BrokerIdentity | null = null;
/** The shell's current color mode (null until the welcome carries one). */
let brokeredTheme: BrokerTheme | null = null;
/** Subscribers notified whenever the brokered theme arrives or changes. */
const themeListeners = new Set<() => void>();
/** Origin of the hosting shell, learned from the welcome — posts pin to it. */
let parentOrigin = "*";
let reqCounter = 0;
let initPromise: Promise<BrokerIdentity | null> | null = null;
let listenerAttached = false;
/** Resolver for an in-flight handshake, fired the instant welcome arrives. */
let finishHandshake: ((id: BrokerIdentity | null) => void) | null = null;

const pending = new Map<
  string,
  { resolve: (res: Response) => void; reject: (err: Error) => void; url: string }
>();

function ensureSlash(u: string): string {
  return u.endsWith("/") ? u : u + "/";
}

function isFramed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin parent makes `window.top` access throw — we're framed.
    return true;
  }
}

export function isBrokered(): boolean {
  return brokered !== null;
}

export function brokeredIdentity(): BrokerIdentity | null {
  return brokered;
}

/** The shell's color mode when embedded, or null (standalone / not yet known). */
export function currentBrokeredTheme(): BrokerTheme | null {
  return brokeredTheme;
}

/** Subscribe to brokered-theme changes; returns an unsubscribe. */
export function subscribeBrokeredTheme(fn: () => void): () => void {
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
}

/**
 * The active identity, brokered-first. Inside the shell this is the shell's
 * webId + workspace pod root; standalone it's the local OIDC session. `null`
 * means signed-out (and not brokered).
 */
export function currentIdentity(): { webId: string; podRoot: string } | null {
  if (brokered) return { webId: brokered.webId, podRoot: brokered.podRoot };
  const info = session().info;
  if (info.isLoggedIn && info.webId) {
    return { webId: info.webId, podRoot: podRootFromWebId(info.webId) };
  }
  return null;
}

// ── base64 framing (chunked so large files don't blow the call stack) ────────

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v;
    return out;
  }
  return { ...(h as Record<string, string>) };
}

async function encodeBody(
  body: BodyInit | null | undefined
): Promise<{ body?: string; bodyEncoding?: "utf8" | "base64" }> {
  if (body == null) return {};
  if (typeof body === "string") return { body, bodyEncoding: "utf8" };
  if (body instanceof Blob) {
    return { body: bytesToBase64(new Uint8Array(await body.arrayBuffer())), bodyEncoding: "base64" };
  }
  if (body instanceof ArrayBuffer) {
    return { body: bytesToBase64(new Uint8Array(body)), bodyEncoding: "base64" };
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return {
      body: bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
      bodyEncoding: "base64",
    };
  }
  // URLSearchParams / FormData and friends — best-effort stringify.
  return { body: String(body), bodyEncoding: "utf8" };
}

function reconstructHeaders(h: Record<string, string> | undefined): Headers {
  const out = new Headers();
  if (!h) return out;
  for (const [k, v] of Object.entries(h)) {
    const lk = k.toLowerCase();
    // Drop length/encoding — they'd contradict the body we just rebuilt.
    if (lk === "content-length" || lk === "content-encoding") continue;
    try {
      out.set(k, v);
    } catch {
      /* forbidden header name — skip */
    }
  }
  return out;
}

// ── message handling ─────────────────────────────────────────────────────────

interface BridgeData {
  t?: string;
  v?: number;
  id?: string;
  identity?: { webId?: string; workspacePod?: string };
  theme?: string;
  status?: number;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
  encoding?: "utf8" | "base64";
  reason?: string;
  message?: string;
}

function onMessage(ev: MessageEvent) {
  // Only ever trust our own parent window.
  if (ev.source !== window.parent) return;
  const data = ev.data as BridgeData | null;
  if (!data || typeof data !== "object" || data.v !== PROTOCOL_VERSION) return;

  if (data.t === "mind:welcome") {
    parentOrigin = ev.origin && ev.origin !== "null" ? ev.origin : "*";
    const id = data.identity;
    if (id?.webId && id?.workspacePod) {
      brokered = { webId: id.webId, podRoot: ensureSlash(id.workspacePod) };
      finishHandshake?.(brokered);
    }
    // The shell re-broadcasts welcome on every theme toggle, so handle theme on
    // each welcome (not just the first) and notify subscribers on change.
    if ((data.theme === "light" || data.theme === "dark") && data.theme !== brokeredTheme) {
      brokeredTheme = data.theme;
      themeListeners.forEach((fn) => fn());
    }
    return;
  }

  const id = data.id;
  if (typeof id !== "string") return;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);

  if (data.t === "mind:fetch:result") {
    const status = data.status ?? 200;
    const init = { status, headers: reconstructHeaders(data.headers) };
    // 101/204/205/304 are "null body" statuses — the Response constructor
    // rejects ANY body for them (even ""), so a DELETE → 205 must pass null.
    const nullBody = status === 101 || status === 204 || status === 205 || status === 304;
    const res = nullBody
      ? new Response(null, init)
      : data.encoding === "base64"
        ? new Response(base64ToBytes(data.body ?? "") as unknown as BodyInit, init)
        : new Response(data.body ?? "", init);
    // A constructed Response has url "", which breaks RDF parsers that resolve
    // relative IRIs against it. Restore the real fetched URL the shell reported.
    const finalUrl = data.url || p.url;
    if (finalUrl) {
      try {
        Object.defineProperty(res, "url", { value: finalUrl, configurable: true });
      } catch {
        /* non-configurable in some engines — best effort */
      }
    }
    p.resolve(res);
  } else if (data.t === "mind:denied") {
    // Surface scope denials as a real HTTP error so the pod libs handle it.
    p.resolve(
      new Response(data.reason ?? "out of scope", {
        status: 403,
        statusText: "Forbidden (out of workspace scope)",
      })
    );
  } else if (data.t === "mind:fail") {
    p.reject(new Error(data.message ?? "bridge fetch failed"));
  }
}

/**
 * A `fetch`-compatible function that tunnels the request through the shell's
 * broker. Only safe to call once {@link isBrokered} is true (after a successful
 * {@link initBroker}); `pod-fs.ts` guards that.
 */
export const brokerFetch: typeof fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  const headers = headersToRecord(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  const enc = await encodeBody(init?.body);
  const id = `df-${++reqCounter}`;
  const msg = {
    t: "mind:fetch",
    v: PROTOCOL_VERSION,
    id,
    url,
    init: { method, headers, ...enc, cache: init?.cache },
  };

  return new Promise<Response>((resolve, reject) => {
    pending.set(id, { resolve, reject, url });
    try {
      window.parent.postMessage(msg, parentOrigin);
    } catch (e) {
      pending.delete(id);
      reject(e as Error);
      return;
    }
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("bridge fetch timeout"));
      }
    }, FETCH_TIMEOUT_MS);
  });
}) as typeof fetch;

/**
 * Run the handshake if framed. Memoized (single-flight) so the many call sites
 * that `await ensureSession()` share one round-trip. Resolves the brokered
 * identity, or `null` when no Mind shell answers (foreign embed / standalone).
 */
export function initBroker(): Promise<BrokerIdentity | null> {
  if (brokered) return Promise.resolve(brokered);
  if (initPromise) return initPromise;
  if (!isFramed()) {
    initPromise = Promise.resolve(null);
    return initPromise;
  }

  initPromise = new Promise<BrokerIdentity | null>((resolve) => {
    if (!listenerAttached) {
      window.addEventListener("message", onMessage);
      listenerAttached = true;
    }
    let settled = false;
    const done = (val: BrokerIdentity | null) => {
      if (settled) return;
      settled = true;
      finishHandshake = null;
      clearInterval(retry);
      clearTimeout(timeout);
      resolve(val);
    };
    finishHandshake = done;
    const sendHello = () => {
      // Hello carries no secret, so "*" is fine; subsequent posts pin to the
      // shell origin learned from the welcome.
      try {
        window.parent.postMessage({ t: "mind:hello", v: PROTOCOL_VERSION }, "*");
      } catch {
        /* parent gone — timeout will resolve null */
      }
    };
    sendHello();
    const retry = setInterval(sendHello, HELLO_RETRY_MS);
    const timeout = setTimeout(() => done(brokered), HANDSHAKE_TIMEOUT_MS);
  });
  return initPromise;
}

/** Tell the host the app has rendered (clears the shell's loading overlay). */
export function signalReady() {
  if (!brokered) return;
  try {
    window.parent.postMessage({ t: "mind:ready", v: PROTOCOL_VERSION }, parentOrigin);
  } catch {
    /* non-fatal */
  }
}
