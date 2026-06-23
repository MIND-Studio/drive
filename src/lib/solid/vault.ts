"use client";

/**
 * Passphrase vault — a per-user, in-pod, encrypted index of the encrypted
 * files in this drive. When you upload a file with encryption on, an entry is
 * recorded here linking the file to the passphrase that unlocks it, so you can
 * later search your vault and recover which passphrase opens which file.
 *
 * Privacy: the vault NEVER leaves the pod in plaintext. It is stored as a
 * single encrypted resource using the same AES-GCM envelope as file uploads
 * (see {@link encryptFile}), wrapped under the user's session passphrase — the
 * same passphrase used to encrypt files this session. There is no central DB
 * (privacy invariant #2): the vault lives only in the user's own pod.
 *
 * On the pod:
 *   <driveRoot>.vault.enc        — ciphertext of the vault JSON
 *   <driveRoot>.vault.enc.json   — the AES-GCM sidecar (iv, wrapped key, …)
 *
 * Both are hidden from the drive listing (the `.enc.json` suffix is filtered
 * already; the `.vault.enc` file is filtered explicitly in DriveBrowser).
 */

import { decryptFile, type EncryptedSidecar, encryptFile, sidecarUrlFor } from "@/lib/solid/crypto";
import { readFileBlob, writeFileBlob } from "@/lib/solid/pod-fs";

export const VAULT_BASENAME = ".vault.enc";

export type VaultEntry = {
  /** The `.enc` resource URL on the pod. */
  fileUrl: string;
  /** Original (decrypted) filename, e.g. "photo.png". */
  name: string;
  /** Passphrase that decrypts this file. */
  passphrase: string;
  /** ISO timestamp the entry was recorded. */
  addedAt: string;
};

export type VaultData = { v: 1; entries: VaultEntry[] };

const EMPTY: VaultData = { v: 1, entries: [] };

export function vaultUrlFor(driveRoot: string): string {
  return driveRoot + VAULT_BASENAME;
}

export function isVaultName(name: string): boolean {
  return name === VAULT_BASENAME || name === `${VAULT_BASENAME}.json`;
}

/**
 * Load and decrypt the vault. A missing vault (never created) resolves to an
 * empty vault — that is not an error. A wrong passphrase rejects (so the caller
 * can re-prompt), same as opening any encrypted file.
 */
export async function loadVault(driveRoot: string, passphrase: string): Promise<VaultData> {
  const url = vaultUrlFor(driveRoot);
  let ciphertext: Blob;
  let sidecar: EncryptedSidecar;
  try {
    ciphertext = await readFileBlob(url);
    const sidecarBlob = await readFileBlob(sidecarUrlFor(url));
    sidecar = JSON.parse(await sidecarBlob.text()) as EncryptedSidecar;
  } catch {
    // No vault yet (or sidecar missing) — start fresh.
    return { ...EMPTY };
  }
  const plaintext = await decryptFile(passphrase, ciphertext, sidecar);
  const data = JSON.parse(await plaintext.text()) as VaultData;
  if (data.v !== 1 || !Array.isArray(data.entries)) return { ...EMPTY };
  return data;
}

/** Encrypt and write the vault back to the pod. */
export async function saveVault(
  driveRoot: string,
  passphrase: string,
  data: VaultData,
): Promise<void> {
  const url = vaultUrlFor(driveRoot);
  const json = new Blob([JSON.stringify(data)], { type: "application/json" });
  const { ciphertext, sidecar } = await encryptFile(passphrase, json, VAULT_BASENAME);
  await writeFileBlob(url, ciphertext, "application/octet-stream");
  const sidecarBlob = new Blob([JSON.stringify(sidecar)], { type: "application/json" });
  await writeFileBlob(sidecarUrlFor(url), sidecarBlob, "application/json");
}

/**
 * Upsert one or more entries into the vault (keyed by fileUrl) and persist.
 * Batched so a multi-file upload does one load + one save, not N of each.
 */
export async function addVaultEntries(
  driveRoot: string,
  passphrase: string,
  entries: VaultEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const data = await loadVault(driveRoot, passphrase);
  for (const entry of entries) {
    const idx = data.entries.findIndex((e) => e.fileUrl === entry.fileUrl);
    if (idx >= 0) data.entries[idx] = entry;
    else data.entries.push(entry);
  }
  await saveVault(driveRoot, passphrase, data);
}

/** Remove an entry by its file URL and persist (no-op if absent). */
export async function removeVaultEntry(
  driveRoot: string,
  passphrase: string,
  fileUrl: string,
): Promise<void> {
  const data = await loadVault(driveRoot, passphrase);
  const next = data.entries.filter((e) => e.fileUrl !== fileUrl);
  if (next.length === data.entries.length) return;
  await saveVault(driveRoot, passphrase, { ...data, entries: next });
}

/** Case-insensitive filter over entry name + file URL. */
export function searchVaultEntries(entries: VaultEntry[], query: string): VaultEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) => e.name.toLowerCase().includes(q) || e.fileUrl.toLowerCase().includes(q),
  );
}
