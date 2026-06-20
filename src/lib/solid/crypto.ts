"use client";

/**
 * Client-side AES-GCM encryption for files written to the pod. The user's
 * passphrase never leaves the browser; the pod stores only ciphertext + a
 * small JSON sidecar describing how to decrypt.
 *
 * Format on the pod:
 *   /foo/bar.txt.enc        — ciphertext (binary)
 *   /foo/bar.txt.enc.json   — JSON sidecar: { v, iv, wrappedKey, kdfSalt,
 *                                              kdfIters, originalName,
 *                                              contentType }
 *
 * The sidecar is `.enc.json`, NOT `.meta`, because CSS automatically rewrites
 * `*.meta` paths as the auto-generated description resource for the matching
 * RDF resource — fetching `bar.txt.enc.meta` returns Turtle, not what we PUT.
 *
 * The KEK is derived from the user's passphrase via PBKDF2-SHA256 with a
 * per-file random salt. Argon2id would be stronger; we pick PBKDF2 because
 * it's built into Web Crypto and avoids shipping a WASM dependency in v0.
 *
 * Session passphrase: held in module-level memory only, lost on tab close.
 * Callers must prompt the user when `getSessionPassphrase()` returns null.
 */

const KDF_ITERS = 250_000;
const KEY_LEN = 256;
const IV_LEN = 12;
const SALT_LEN = 16;

export type EncryptedSidecar = {
  v: 1;
  iv: string; // base64
  wrappedKey: string; // base64
  kdfSalt: string; // base64
  kdfIters: number;
  originalName: string;
  contentType: string;
};

let sessionPassphrase: string | null = null;

export function getSessionPassphrase(): string | null {
  return sessionPassphrase;
}

export function setSessionPassphrase(p: string | null) {
  sessionPassphrase = p;
}

export function isEncryptedName(name: string): boolean {
  return name.endsWith(".enc");
}

export function originalNameFromEnc(name: string): string {
  return name.endsWith(".enc") ? name.slice(0, -4) : name;
}

export function sidecarUrlFor(fileUrl: string): string {
  return fileUrl + ".json";
}

export function isEncSidecarName(name: string): boolean {
  return name.endsWith(".enc.json");
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKek(passphrase: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: iters,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: KEY_LEN },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export type EncryptedBlob = {
  ciphertext: Blob;
  sidecar: EncryptedSidecar;
};

/**
 * Encrypt a file's bytes under a fresh random AES-GCM key, then wrap that
 * key with the passphrase-derived KEK. Returns a ciphertext blob and the
 * sidecar JSON the caller should write alongside it.
 */
export async function encryptFile(
  passphrase: string,
  file: Blob,
  originalName: string,
): Promise<EncryptedBlob> {
  const fileKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: KEY_LEN }, true, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    fileKey,
    plaintext as BufferSource,
  );

  const kdfSalt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const kek = await deriveKek(passphrase, kdfSalt, KDF_ITERS);
  const wrappedKeyBuf = await crypto.subtle.wrapKey("raw", fileKey, kek, {
    name: "AES-GCM",
    iv: iv as BufferSource,
  });

  const sidecar: EncryptedSidecar = {
    v: 1,
    iv: b64(iv),
    wrappedKey: b64(new Uint8Array(wrappedKeyBuf)),
    kdfSalt: b64(kdfSalt),
    kdfIters: KDF_ITERS,
    originalName,
    contentType: file.type || "application/octet-stream",
  };
  return {
    ciphertext: new Blob([ciphertextBuf], { type: "application/octet-stream" }),
    sidecar,
  };
}

/**
 * Decrypt a ciphertext blob using its sidecar and the passphrase. Returns
 * a Blob tagged with the sidecar's contentType so the preview UI can render
 * it as if it had been fetched directly.
 */
export async function decryptFile(
  passphrase: string,
  ciphertext: Blob,
  sidecar: EncryptedSidecar,
): Promise<Blob> {
  if (sidecar.v !== 1) {
    throw new Error(`Unsupported sidecar version: ${sidecar.v}`);
  }
  const iv = unb64(sidecar.iv);
  const wrappedKey = unb64(sidecar.wrappedKey);
  const kdfSalt = unb64(sidecar.kdfSalt);
  const kek = await deriveKek(passphrase, kdfSalt, sidecar.kdfIters);
  let fileKey: CryptoKey;
  try {
    fileKey = await crypto.subtle.unwrapKey(
      "raw",
      wrappedKey as BufferSource,
      kek,
      { name: "AES-GCM", iv: iv as BufferSource },
      { name: "AES-GCM", length: KEY_LEN },
      false,
      ["decrypt"],
    );
  } catch {
    throw new Error("Wrong passphrase, or the file has been tampered with.");
  }
  const ct = new Uint8Array(await ciphertext.arrayBuffer());
  const plaintextBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    fileKey,
    ct as BufferSource,
  );
  return new Blob([plaintextBuf], { type: sidecar.contentType });
}
