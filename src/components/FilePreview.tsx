"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { session } from "@/lib/solid/session";
import { ensureSession } from "@/lib/solid/auth";
import ShareDialog from "@/components/ShareDialog";
import PassphraseDialog from "@/components/PassphraseDialog";
import {
  decryptFile,
  getSessionPassphrase,
  setSessionPassphrase,
  isEncryptedName,
  originalNameFromEnc,
  sidecarUrlFor,
  type EncryptedSidecar,
} from "@/lib/solid/crypto";
import { driveRootFor, podRootFromWebId, normalizeSegment } from "@/lib/config";
import {
  readFileBlob,
  unlink,
  rename,
  guessContentType,
} from "@/lib/solid/pod-fs";

type State =
  | { kind: "booting" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | { kind: "needs-passphrase"; sidecar: EncryptedSidecar; ciphertext: Blob; fileUrl: string; driveRoot: string; webId: string; error?: string }
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

export default function FilePreview({
  pathSegments,
}: {
  pathSegments: string[];
}) {
  const [state, setState] = useState<State>({ kind: "booting" });

  const load = useCallback(async () => {
    const s = session();
    if (!s.info.isLoggedIn || !s.info.webId) {
      setState({ kind: "signed-out" });
      return;
    }
    const podRoot = podRootFromWebId(s.info.webId);
    const driveRoot = driveRootFor(podRoot);
    const fileUrl =
      driveRoot + pathSegments.map(normalizeSegment).join("/");
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
            webId: s.info.webId,
          });
          return;
        }
        try {
          const plaintext = await decryptFile(passphrase, blob, sidecar);
          setState({
            kind: "ready",
            webId: s.info.webId,
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
            webId: s.info.webId,
            error: String(e),
          });
        }
        return;
      }
      const contentType = blob.type || guessContentType(leaf);
      setState({
        kind: "ready",
        webId: s.info.webId,
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
        <p className="text-[color:var(--ink-faint)]">Loading…</p>
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
        <div className="rounded-md border border-[color:var(--status-bad)] bg-[color:var(--status-bad-soft)] p-5">
          <p
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--status-bad)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            File error
          </p>
          <p className="mono mt-2 break-all text-sm">{state.message}</p>
          <Link
            href="/drive"
            className="mt-4 inline-block rounded-md border border-[color:var(--ink-trace)] px-3 py-1.5 text-sm hover:border-[color:var(--accent)]"
          >
            ← Back to My Drive
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Crumbs pathSegments={pathSegments} />
      <Header
        state={state}
        pathSegments={pathSegments}
        onChanged={load}
      />
      <PreviewBody
        blob={state.blob}
        contentType={state.contentType}
        fileUrl={state.fileUrl}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-4xl px-6 py-10 sm:px-10">{children}</section>
  );
}

function SignedOut() {
  return (
    <div className="rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] p-8 text-center">
      <p className="display text-2xl" style={{ fontFamily: "var(--font-display)" }}>
        Connect your pod to view files.
      </p>
      <Link
        href="/connect"
        className="mt-6 inline-block rounded-md bg-[color:var(--accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[color:var(--accent-deep)]"
      >
        Connect a pod
      </Link>
    </div>
  );
}

function Crumbs({ pathSegments }: { pathSegments: string[] }) {
  const crumbs = useMemo(() => {
    const acc: { label: string; href: string }[] = [
      { label: "My Drive", href: "/drive" },
    ];
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
            {i > 0 ? <span className="text-[color:var(--ink-faint)]">/</span> : null}
            {isLast ? (
              <span className="mono text-sm text-[color:var(--ink)]">{c.label}</span>
            ) : (
              <Link
                href={c.href}
                className="text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
              >
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

  async function onDelete() {
    if (!window.confirm(`Delete ${fileName}?`)) return;
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
    <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--ink-trace)] pb-4">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <form onSubmit={onRenameSubmit} className="flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 rounded-md border border-[color:var(--accent)] bg-[color:var(--paper)] px-3 py-1.5 text-sm focus:outline-none"
              data-testid="file-rename-input"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[color:var(--accent-deep)] disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setRenaming(false);
                setNewName(fileName);
              }}
              className="rounded-md border border-[color:var(--ink-trace)] px-3 py-1.5 text-sm hover:border-[color:var(--accent)]"
            >
              Cancel
            </button>
          </form>
        ) : (
          <h1
            className="display truncate text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
            data-testid="file-name"
          >
            {isEnc ? "🔒 " : ""}{fileName}
          </h1>
        )}
        <p
          className="mt-1 text-xs text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          {state.contentType} · {formatBytes(state.size)}
          {isEnc ? ` · encrypted, decoded in browser` : ""}
        </p>
      </div>
      {!renaming ? (
        <div className="flex gap-2">
          <button
            onClick={onDownload}
            disabled={busy}
            className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[color:var(--accent-deep)] disabled:opacity-50"
            data-testid="file-download"
          >
            ↓ Download
          </button>
          <button
            onClick={() => setSharing(true)}
            disabled={busy}
            className="rounded-md border border-[color:var(--ink-trace)] px-3 py-1.5 text-sm hover:border-[color:var(--accent)] disabled:opacity-50"
            data-testid="file-share"
          >
            ↗ Share
          </button>
          <button
            onClick={() => setRenaming(true)}
            disabled={busy}
            className="rounded-md border border-[color:var(--ink-trace)] px-3 py-1.5 text-sm hover:border-[color:var(--accent)] disabled:opacity-50"
            data-testid="file-rename"
          >
            ✎ Rename
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            className="rounded-md border border-[color:var(--status-bad)] px-3 py-1.5 text-sm text-[color:var(--status-bad)] hover:bg-[color:var(--status-bad-soft)] disabled:opacity-50"
            data-testid="file-delete"
          >
            × Delete
          </button>
        </div>
      ) : null}
      {sharing ? (
        <ShareDialog
          resourceUrl={state.fileUrl}
          resourceName={fileName}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </div>
  );
}

function PreviewBody({
  blob,
  contentType,
}: {
  blob: Blob;
  contentType: string;
  fileUrl: string;
}) {
  const [textBody, setTextBody] = useState<string | null>(null);
  // The object URL MUST be created inside the effect, not via useMemo. In
  // React 18 dev Strict Mode, effects run twice (mount → cleanup → remount).
  // A useMemo'd URL gets revoked by the first cleanup, then useMemo returns
  // the cached (now-dead) URL on remount — and <video src=…> fails with
  // ERR_FILE_NOT_FOUND. Tying create+revoke to the effect lifecycle gives
  // us a fresh URL on the second mount.
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    let cancelled = false;
    if (isText(contentType)) {
      blob.text().then((t) => {
        if (!cancelled) setTextBody(t);
      });
    }
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [blob, contentType]);

  if (!objectUrl) {
    return (
      <p className="mt-6 text-sm text-[color:var(--ink-faint)]">Loading preview…</p>
    );
  }

  if (contentType.startsWith("image/")) {
    return (
      <div className="mt-6 flex justify-center rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] p-6">
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
        className="mt-6 h-[70vh] w-full rounded-md border border-[color:var(--ink-trace)]"
        data-testid="preview-pdf"
      >
        <p className="p-4 text-sm text-[color:var(--ink-soft)]">
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
        className="mt-6 max-h-[70vh] w-full rounded-md border border-[color:var(--ink-trace)]"
        data-testid="preview-video"
      />
    );
  }

  if (contentType.startsWith("audio/")) {
    return (
      <audio
        controls
        src={objectUrl}
        className="mt-6 w-full"
        data-testid="preview-audio"
      />
    );
  }

  if (isText(contentType)) {
    if (textBody == null)
      return (
        <p className="mt-6 text-sm text-[color:var(--ink-faint)]">Loading text…</p>
      );
    return (
      <pre
        className="mono mt-6 max-h-[70vh] overflow-auto rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] p-4 text-sm leading-relaxed whitespace-pre-wrap"
        data-testid="preview-text"
      >
        {textBody}
      </pre>
    );
  }

  return (
    <div className="mt-6 rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] p-6 text-sm text-[color:var(--ink-soft)]">
      <p>No inline preview for this content type.</p>
      <p className="mt-2 text-xs text-[color:var(--ink-faint)]">{contentType}</p>
    </div>
  );
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
