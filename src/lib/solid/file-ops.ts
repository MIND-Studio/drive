"use client";

import { type EncryptedSidecar, isEncryptedName, sidecarUrlFor } from "@/lib/solid/crypto";
import { readFileBlob, rename, unlink, writeFileBlob } from "@/lib/solid/pod-fs";

/**
 * Rename a file, keeping its extension. The caller passes the new user-facing
 * name WITH its (unchanged) extension, e.g. "holiday.png" — the UI locks the
 * extension so the format can't be changed by a rename.
 *
 * For encrypted files (`<name>.enc`) the on-pod leaf keeps its `.enc` suffix,
 * and the `.enc.json` sidecar is moved alongside with its `originalName`
 * updated — otherwise a rename would orphan the sidecar and the viewer would
 * keep showing the old name. Returns the new resource URL.
 */
export async function renameFile(params: {
  fromUrl: string;
  /** New user-facing name WITH extension, e.g. "holiday.png" (never the `.enc`). */
  newDisplayName: string;
}): Promise<string> {
  const { fromUrl, newDisplayName } = params;
  const parent = fromUrl.slice(0, fromUrl.lastIndexOf("/") + 1);
  const enc = isEncryptedName(fromUrl);
  const onPodLeaf = enc ? `${newDisplayName}.enc` : newDisplayName;
  const toUrl = parent + encodeURIComponent(onPodLeaf);
  if (toUrl === fromUrl) return fromUrl;

  if (enc) {
    const fromSidecar = sidecarUrlFor(fromUrl);
    const toSidecar = sidecarUrlFor(toUrl);
    const sidecarBlob = await readFileBlob(fromSidecar);
    const sidecar = JSON.parse(await sidecarBlob.text()) as EncryptedSidecar;
    sidecar.originalName = newDisplayName;
    await writeFileBlob(
      toSidecar,
      new Blob([JSON.stringify(sidecar)], { type: "application/json" }),
      "application/json",
    );
    await rename(fromUrl, toUrl);
    await unlink(fromSidecar).catch(() => {});
    return toUrl;
  }

  await rename(fromUrl, toUrl);
  return toUrl;
}
