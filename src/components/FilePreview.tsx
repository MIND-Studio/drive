"use client";

import { Button, Input } from "@mind-studio/ui";
import { ArrowLeft, Download, Pencil, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import PassphraseDialog from "@/components/PassphraseDialog";
import ShareDialog from "@/components/ShareDialog";
import { driveRootFor, normalizeSegment } from "@/lib/config";
import { ensureSession, rememberSignedOutPath } from "@/lib/solid/auth";
import { currentIdentity } from "@/lib/solid/broker";
import {
  decryptFile,
  type EncryptedSidecar,
  getSessionPassphrase,
  isEncryptedName,
  originalNameFromEnc,
  setSessionPassphrase,
  sidecarUrlFor,
} from "@/lib/solid/crypto";
import { guessContentType, readFileBlob, rename, unlink } from "@/lib/solid/pod-fs";

type State =
  | { kind: "booting" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | {
      kind: "needs-passphrase";
      sidecar: EncryptedSidecar;
      ciphertext: Blob;
      fileUrl: string;
      driveRoot: string;
      webId: string;
      error?: string;
    }
  | {
      kind: "ready";
      webId: string;
      driveRoot: string;
      fileUrl: string;
      blob: Blob;
      contentType: string;
      size: number;
      /** Original (decrypted) name if this was an .enc file. */
      decryptedName?: string;
    };

export default function FilePreview({ pathSegments }: { pathSegments: string[] }) {
  const [state, setState] = useState<State>({ kind: "booting" });

  const load = useCallback(async () => {
    // Identity is brokered-first: inside the Mind shell it's the shell's webId +
    // workspace pod root (no local session); standalone it's the OIDC session.
    const id = currentIdentity();
    if (!id) {
      setState({ kind: "signed-out" });
      return;
    }
    const driveRoot = driveRootFor(id.podRoot);
    const fileUrl = driveRoot + pathSegments.map(normalizeSegment).join("/");
    const leaf = safeDecode(pathSegments[pathSegments.length - 1] ?? "");
    try {
      const blob = await readFileBlob(fileUrl);
      if (isEncryptedName(leaf)) {
        // Fetch the sidecar to learn how to decrypt.
        const sidecarBlob = await readFileBlob(sidecarUrlFor(fileUrl));
        const sidecar = JSON.parse(await sidecarBlob.text()) as EncryptedSidecar;
        const passphrase = getSessionPassphrase();
        if (!passphrase) {
          setState({
            kind: "needs-passphrase",
            sidecar,
            ciphertext: blob,
            fileUrl,
            driveRoot,
            webId: id.webId,
          });
          return;
        }
        try {
          const plaintext = await decryptFile(passphrase, blob, sidecar);
          setState({
            kind: "ready",
            webId: id.webId,
            driveRoot,
            fileUrl,
            blob: plaintext,
            contentType: sidecar.contentType,
            size: plaintext.size,
            decryptedName: sidecar.originalName,
          });
        } catch (e) {
          setState({
            kind: "needs-passphrase",
            sidecar,
            ciphertext: blob,
            fileUrl,
            driveRoot,
            webId: id.webId,
            error: String(e),
          });
        }
        return;
      }
      const contentType = blob.type || guessContentType(leaf);
      setState({
        kind: "ready",
        webId: id.webId,
        driveRoot,
        fileUrl,
        blob,
        contentType,
        size: blob.size,
      });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }, [pathSegments]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSession();
      } catch {
        /* fall through */
      }
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (state.kind === "booting") {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading…</p>
      </Shell>
    );
  }

  if (state.kind === "signed-out") {
    return (
      <Shell>
        <SignedOut />
      </Shell>
    );
  }

  if (state.kind === "needs-passphrase") {
    return (
      <Shell>
        <PassphraseDialog
          title="Decrypt this file"
          prompt={`Enter the passphrase you used to encrypt "${state.sidecar.originalName}".`}
          confirmRequired={false}
          error={state.error}
          onSubmit={(p) => {
            setSessionPassphrase(p);
            void load();
          }}
          onCancel={() => {
            setSessionPassphrase(null);
            history.back();
          }}
        />
      </Shell>
    );
  }

  if (state.kind === "error") {
    return (
      <Shell>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-destructive">
            File error
          </p>
          <p className="mt-2 break-all font-mono text-sm">{state.message}</p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link href="/drive">
              <ArrowLeft className="size-4" /> Back to My Drive
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Crumbs pathSegments={pathSegments} />
      <Header state={state} pathSegments={pathSegments} onChanged={load} />
      <PreviewBody blob={state.blob} contentType={state.contentType} fileUrl={state.fileUrl} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-4xl px-6 py-10 sm:px-10">{children}</section>;
}

function SignedOut() {
  // Remember the file the user deep-linked to, so reconnecting returns here.
  useEffect(() => rememberSignedOutPath(), []);
  return (
    <div className="rounded-lg border bg-card p-8 text-center">
      <p className="text-2xl font-semibold tracking-tight">Connect your pod to view files.</p>
      <Button asChild className="mt-6">
        <Link href="/connect">Connect a pod</Link>
      </Button>
    </div>
  );
}

function Crumbs({ pathSegments }: { pathSegments: string[] }) {
  const crumbs = useMemo(() => {
    const acc: { label: string; href: string }[] = [{ label: "My Drive", href: "/drive" }];
    for (let i = 0; i < pathSegments.length; i++) {
      const slice = pathSegments.slice(0, i + 1);
      const isFile = i === pathSegments.length - 1;
      const href = isFile
        ? "/drive/file/" + slice.map(normalizeSegment).join("/")
        : "/drive/" + slice.map(normalizeSegment).join("/");
      acc.push({
        label: safeDecode(pathSegments[i]),
        href,
      });
    }
    return acc;
  }, [pathSegments]);

  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Breadcrumb">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={c.href} className="flex items-center gap-1">
            {i > 0 ? <span className="text-muted-foreground">/</span> : null}
            {isLast ? (
              <span className="font-mono text-sm text-foreground">{c.label}</span>
            ) : (
              <Link href={c.href} className="text-muted-foreground hover:text-primary">
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function Header({
  state,
  pathSegments,
}: {
  state: Extract<State, { kind: "ready" }>;
  pathSegments: string[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const urlLeaf = safeDecode(pathSegments[pathSegments.length - 1] ?? "");
  const fileName = state.decryptedName ?? urlLeaf;
  const isEnc = !!state.decryptedName;
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(fileName);
  const [sharing, setSharing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function onDownload() {
    setBusy(true);
    try {
      const url = URL.createObjectURL(state.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    try {
      await unlink(state.fileUrl);
      const parentSegments = pathSegments.slice(0, -1);
      const parentHref =
        parentSegments.length === 0
          ? "/drive"
          : "/drive/" + parentSegments.map(normalizeSegment).join("/");
      router.replace(parentHref);
    } catch (e) {
      alert(`Delete failed: ${String(e)}`);
      setBusy(false);
    }
  }

  async function onRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || trimmed === fileName) {
      setRenaming(false);
      setNewName(fileName);
      return;
    }
    setBusy(true);
    try {
      const parent = state.fileUrl.slice(0, state.fileUrl.lastIndexOf("/") + 1);
      const target = parent + encodeURIComponent(trimmed);
      await rename(state.fileUrl, target);
      const parentSegments = pathSegments.slice(0, -1);
      const href =
        "/drive/file/" +
        [...parentSegments.map(normalizeSegment), encodeURIComponent(trimmed)].join("/");
      router.replace(href);
    } catch (err) {
      alert(`Rename failed: ${String(err)}`);
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-b pb-4">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <form onSubmit={onRenameSubmit} className="flex items-center gap-2">
            <Input
              type="text"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-9 flex-1"
              data-testid="file-rename-input"
            />
            <Button type="submit" size="sm" disabled={busy}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setRenaming(false);
                setNewName(fileName);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <h1 className="truncate text-3xl font-semibold tracking-tight" data-testid="file-name">
            {isEnc ? "🔒 " : ""}
            {fileName}
          </h1>
        )}
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {state.contentType} · {formatBytes(state.size)}
          {isEnc ? ` · encrypted, decoded in browser` : ""}
        </p>
      </div>
      {!renaming ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={onDownload} disabled={busy} data-testid="file-download">
            <Download className="size-4" /> Download
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSharing(true)}
            disabled={busy}
            data-testid="file-share"
          >
            <Share2 className="size-4" /> Share
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRenaming(true)}
            disabled={busy}
            data-testid="file-rename"
          >
            <Pencil className="size-4" /> Rename
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
            data-testid="file-delete"
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      ) : null}
      {sharing ? (
        <ShareDialog
          resourceUrl={state.fileUrl}
          resourceName={fileName}
          onClose={() => setSharing(false)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${fileName}?`}
        description="This permanently deletes the file from your pod. Solid has no trash — this can't be undone."
        onConfirm={doDelete}
      />
    </div>
  );
}

function PreviewBody({ blob, contentType }: { blob: Blob; contentType: string; fileUrl: string }) {
  const [textBody, setTextBody] = useState<string | null>(null);
  // The object URL MUST be created inside the effect, not via useMemo. In
  // React 18 dev Strict Mode, effects run twice (mount → cleanup → remount).
  // A useMemo'd URL gets revoked by the first cleanup, then useMemo returns
  // the cached (now-dead) URL on remount — and <video src=…> fails with
  // ERR_FILE_NOT_FOUND. Tying create+revoke to the effect lifecycle gives
  // us a fresh URL on the second mount.
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    const assign = (b: Blob) => {
      if (cancelled) return;
      createdUrl = URL.createObjectURL(b);
      setObjectUrl(createdUrl);
    };
    if (contentType === "image/svg+xml") {
      // Rewrite anchor targets to _blank so links open in a new tab rather
      // than replacing the Drive app (and dropping the in-memory pod session).
      // The blob carries the rewritten markup, not the original bytes.
      blob.text().then((t) => assign(svgBlobForPreview(t)));
    } else {
      assign(blob);
      if (isText(contentType)) {
        blob.text().then((t) => {
          if (!cancelled) setTextBody(t);
        });
      }
    }
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [blob, contentType]);

  if (!objectUrl) {
    return <p className="mt-6 text-sm text-muted-foreground">Loading preview…</p>;
  }

  if (contentType === "image/svg+xml") {
    // SVG can carry clickable <a> links and hover CSS — render it in its own
    // browsing context so those work, unlike <img> which renders SVG as an
    // inert image. The file is arbitrary user upload, so sandbox it: no
    // scripts (omit allow-scripts), unique origin, no top-navigation (the SVG
    // can't replace the Drive app). Links open in a fresh, un-sandboxed tab
    // via allow-popups + allow-popups-to-escape-sandbox; targets are rewritten
    // to _blank in svgBlobForPreview. Only absolute hrefs work — relative ones
    // have no base to resolve against under a blob: URL.
    return (
      <iframe
        src={objectUrl}
        title="SVG preview"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        className="mt-6 h-[70vh] w-full rounded-lg border bg-muted/40"
        data-testid="preview-svg"
      />
    );
  }

  if (contentType.startsWith("image/")) {
    return (
      <div className="mt-6 flex justify-center rounded-lg border bg-muted/40 p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={objectUrl}
          alt=""
          className="max-h-[70vh] max-w-full rounded-sm"
          data-testid="preview-image"
        />
      </div>
    );
  }

  if (contentType === "application/pdf") {
    return (
      <object
        data={objectUrl}
        type="application/pdf"
        className="mt-6 h-[70vh] w-full rounded-lg border"
        data-testid="preview-pdf"
      >
        <p className="p-4 text-sm text-muted-foreground">
          PDF preview unavailable. Try downloading the file.
        </p>
      </object>
    );
  }

  if (contentType.startsWith("video/")) {
    return (
      <video
        controls
        src={objectUrl}
        className="mt-6 max-h-[70vh] w-full rounded-lg border"
        data-testid="preview-video"
      />
    );
  }

  if (contentType.startsWith("audio/")) {
    return <audio controls src={objectUrl} className="mt-6 w-full" data-testid="preview-audio" />;
  }

  if (isText(contentType)) {
    if (textBody == null)
      return <p className="mt-6 text-sm text-muted-foreground">Loading text…</p>;
    return (
      <pre
        className="mt-6 max-h-[70vh] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap"
        data-testid="preview-text"
      >
        {textBody}
      </pre>
    );
  }

  return (
    <div className="mt-6 rounded-lg border bg-muted/40 p-6 text-sm text-muted-foreground">
      <p>No inline preview for this content type.</p>
      <p className="mt-2 text-xs text-muted-foreground">{contentType}</p>
    </div>
  );
}

/**
 * Prepare an SVG for the sandboxed preview: force every anchor to open in a
 * new tab. The diagram SVGs use target="_top", which would navigate the whole
 * Drive tab away (and drop the in-memory pod session); rewriting to _blank
 * keeps Drive in place. Anchors with no target get one too. We do not touch
 * hrefs — absolute links work, relative ones stay inert (no base under blob:).
 */
function svgBlobForPreview(svg: string): Blob {
  const rewritten = svg
    .replace(/\btarget\s*=\s*("|')(?:_top|_self|_parent)\1/gi, 'target="_blank"')
    .replace(/<a\b(?![^>]*\btarget\s*=)([^>]*?)>/gi, '<a target="_blank"$1>');
  return new Blob([rewritten], { type: "image/svg+xml" });
}

function isText(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml" ||
    contentType === "application/javascript"
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
