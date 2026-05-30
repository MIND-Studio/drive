"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { session } from "@/lib/solid/session";
import { ensureSession } from "@/lib/solid/auth";
import { ImageThumbnail, isImageName } from "@/components/Thumbnail";
import PassphraseDialog from "@/components/PassphraseDialog";
import {
  encryptFile,
  getSessionPassphrase,
  setSessionPassphrase,
  isEncryptedName,
  sidecarUrlFor,
} from "@/lib/solid/crypto";
import {
  readdir,
  mkdir,
  rmrf,
  rename,
  writeFileBlob,
  guessContentType,
  type PodEntry,
} from "@/lib/solid/pod-fs";
import { driveRootFor, podRootFromWebId, normalizeSegment } from "@/lib/config";

type State =
  | { kind: "booting" }
  | { kind: "signed-out" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      webId: string;
      driveRoot: string;
      containerUrl: string;
      entries: PodEntry[];
    };

const VIEW_MODE_KEY = "mind-drive:view-mode";
type ViewMode = "list" | "grid";

function loadViewMode(): ViewMode {
  if (typeof window === "undefined") return "list";
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return v === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

export default function DriveBrowser({
  pathSegments,
}: {
  pathSegments: string[];
}) {
  const [state, setState] = useState<State>({ kind: "booting" });
  const [uploadProgress, setUploadProgress] = useState<
    { name: string; done: number; total: number }[]
  >([]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [encryptUploads, setEncryptUploads] = useState(false);
  const [passphrasePrompt, setPassphrasePrompt] = useState<
    null | { pendingFiles: File[]; confirmRequired: boolean }
  >(null);
  /**
   * Sticky upload-error banner. Lives outside `state` so the `finally`-block
   * refresh() in uploadFiles doesn't wipe it. Cleared on the next successful
   * upload or when the user dismisses it.
   */
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    setViewMode(loadViewMode());
  }, []);

  const onViewModeChange = useCallback((v: ViewMode) => {
    setViewMode(v);
    try {
      localStorage.setItem(VIEW_MODE_KEY, v);
    } catch {}
  }, []);

  const refresh = useCallback(async () => {
    const s = session();
    if (!s.info.isLoggedIn || !s.info.webId) {
      setState({ kind: "signed-out" });
      return;
    }
    const podRoot = podRootFromWebId(s.info.webId);
    const driveRoot = driveRootFor(podRoot);
    const containerUrl =
      pathSegments.length === 0
        ? driveRoot
        : driveRoot + pathSegments.map(normalizeSegment).join("/") + "/";
    try {
      const entries = await readdir(containerUrl);
      setState({
        kind: "ready",
        webId: s.info.webId,
        driveRoot,
        containerUrl,
        entries,
      });
    } catch (e) {
      if (containerUrl === driveRoot && /404/.test(String(e))) {
        try {
          await mkdir(driveRoot);
          const entries = await readdir(containerUrl);
          setState({
            kind: "ready",
            webId: s.info.webId,
            driveRoot,
            containerUrl,
            entries,
          });
          return;
        } catch (e2) {
          setState({ kind: "error", message: String(e2) });
          return;
        }
      }
      setState({ kind: "error", message: String(e) });
    }
  }, [pathSegments]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSession();
      } catch {
        /* fall through — refresh handles signed-out state */
      }
      if (cancelled) return;
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (state.kind !== "ready" || files.length === 0) return;

      if (encryptUploads && !getSessionPassphrase()) {
        // First encrypted upload of this session — collect a passphrase
        // before doing anything. The confirm-required flow doubles as a
        // typo guard since there's no recovery.
        setPassphrasePrompt({ pendingFiles: files, confirmRequired: true });
        return;
      }

      const startProgress = files.map((f) => ({
        name: encryptUploads ? f.name + ".enc" : f.name,
        done: 0,
        total: f.size,
      }));
      setUploadProgress(startProgress);
      setUploadError(null);
      let failed = false;
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (encryptUploads) {
            const passphrase = getSessionPassphrase();
            if (!passphrase) throw new Error("Missing session passphrase");
            const { ciphertext, sidecar } = await encryptFile(passphrase, f, f.name);
            const encUrl =
              state.containerUrl + encodeURIComponent(f.name) + ".enc";
            const metaUrl = sidecarUrlFor(encUrl);
            await writeFileBlob(encUrl, ciphertext, "application/octet-stream");
            const sidecarBlob = new Blob([JSON.stringify(sidecar)], {
              type: "application/json",
            });
            await writeFileBlob(metaUrl, sidecarBlob, "application/json");
          } else {
            const url = state.containerUrl + encodeURIComponent(f.name);
            const contentType = f.type || guessContentType(f.name);
            await writeFileBlob(url, f, contentType);
          }
          setUploadProgress((prev) =>
            prev.map((p, idx) =>
              idx === i ? { ...p, done: p.total } : p
            )
          );
        }
      } catch (e) {
        failed = true;
        // Sticky banner — survives the refresh() in finally, unlike the
        // earlier `setState({kind:"error"})` approach which got overwritten.
        setUploadError(String(e));
      } finally {
        setTimeout(() => setUploadProgress([]), failed ? 0 : 600);
        await refresh();
      }
    },
    [refresh, state, encryptUploads]
  );

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

  if (state.kind === "error") {
    return (
      <Shell>
        <ErrorPanel message={state.message} onRetry={refresh} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Crumbs
        driveRoot={state.driveRoot}
        containerUrl={state.containerUrl}
        pathSegments={pathSegments}
      />
      <Toolbar
        containerUrl={state.containerUrl}
        onChanged={refresh}
        onUpload={uploadFiles}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        encryptUploads={encryptUploads}
        onEncryptUploadsChange={setEncryptUploads}
      />
      {uploadProgress.length > 0 ? (
        <UploadProgress items={uploadProgress} />
      ) : null}
      {uploadError ? (
        <div
          className="mt-4 flex items-start justify-between gap-3 rounded-md border border-[color:var(--status-bad)] bg-[color:var(--status-bad-soft)] p-3"
          data-testid="upload-error-banner"
        >
          <div className="min-w-0">
            <p
              className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--status-bad)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              Upload failed
            </p>
            <p className="mono mt-1 break-all text-xs text-[color:var(--ink)]">
              {uploadError}
            </p>
            <p className="mt-2 text-[10px] text-[color:var(--ink-faint)]">
              Common causes: signed-out session (re-login at /connect), the
              filename collides with an existing folder, or your pod denied the
              write.
            </p>
          </div>
          <button
            onClick={() => setUploadError(null)}
            className="rounded-md border border-[color:var(--ink-trace)] px-2 py-0.5 text-xs hover:border-[color:var(--accent)]"
          >
            ×
          </button>
        </div>
      ) : null}
      <Dropzone onDrop={uploadFiles}>
        <Listing
          entries={filterEntries(hideEncryptedSidecars(state.entries), searchQuery)}
          driveRoot={state.driveRoot}
          containerUrl={state.containerUrl}
          onChanged={refresh}
          viewMode={viewMode}
          searchQuery={searchQuery}
        />
      </Dropzone>
      {passphrasePrompt ? (
        <PassphraseDialog
          title="Set an encryption passphrase"
          prompt="Files you upload with encryption on will be stored as ciphertext in your pod. You'll need this passphrase to decrypt them later. We never see it."
          confirmRequired={passphrasePrompt.confirmRequired}
          onSubmit={(p) => {
            setSessionPassphrase(p);
            const files = passphrasePrompt.pendingFiles;
            setPassphrasePrompt(null);
            // re-trigger upload now that we have a passphrase
            void uploadFiles(files);
          }}
          onCancel={() => setPassphrasePrompt(null)}
        />
      ) : null}
    </Shell>
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function hideEncryptedSidecars(entries: PodEntry[]): PodEntry[] {
  // The .enc.json sidecars are an implementation detail; surfacing them in
  // the listing would be confusing. The matching .enc rows already carry
  // a 🔒 in their icon.
  return entries.filter((e) => !e.name.endsWith(".enc.json"));
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-5xl px-6 py-10 sm:px-10">{children}</section>
  );
}

function SignedOut() {
  return (
    <div className="rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] p-8 text-center">
      <p className="display text-2xl" style={{ fontFamily: "var(--font-display)" }}>
        Connect your pod to see your drive.
      </p>
      <p className="mt-3 text-sm text-[color:var(--ink-soft)]">
        Mind Drive only reads files you authorize. Sign in with your WebID to
        get started.
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

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-md border border-[color:var(--status-bad)] bg-[color:var(--status-bad-soft)] p-5">
      <p
        className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--status-bad)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        Pod error
      </p>
      <p className="mono mt-2 break-all text-sm">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 rounded-md border border-[color:var(--ink-trace)] px-3 py-1.5 text-sm hover:border-[color:var(--accent)]"
      >
        Retry
      </button>
    </div>
  );
}

function Crumbs({
  driveRoot,
  containerUrl,
  pathSegments,
}: {
  driveRoot: string;
  containerUrl: string;
  pathSegments: string[];
}) {
  const crumbs = useMemo(() => {
    const acc: { label: string; href: string }[] = [
      { label: "My Drive", href: "/drive" },
    ];
    for (let i = 0; i < pathSegments.length; i++) {
      const slice = pathSegments.slice(0, i + 1);
      acc.push({
        label: safeDecode(pathSegments[i]),
        href: "/drive/" + slice.map(normalizeSegment).join("/"),
      });
    }
    return acc;
  }, [pathSegments]);

  return (
    <div className="flex items-center justify-between">
      <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Breadcrumb">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={c.href} className="flex items-center gap-1">
              {i > 0 ? <span className="text-[color:var(--ink-faint)]">/</span> : null}
              {isLast ? (
                <span
                  className="display text-2xl"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {c.label}
                </span>
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
      <p
        className="mono hidden text-xs text-[color:var(--ink-faint)] sm:block"
        title={containerUrl}
      >
        {containerUrl.replace(driveRoot, "/")}
      </p>
    </div>
  );
}

function Toolbar({
  containerUrl,
  onChanged,
  onUpload,
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchChange,
  encryptUploads,
  onEncryptUploadsChange,
}: {
  containerUrl: string;
  onChanged: () => void;
  onUpload: (files: File[]) => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  encryptUploads: boolean;
  onEncryptUploadsChange: (v: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState(false);

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = folderName.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await mkdir(containerUrl + encodeURIComponent(trimmed) + "/");
      setFolderName("");
      setCreatingFolder(false);
      onChanged();
    } catch (err) {
      alert(`Failed to create folder: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <button
        onClick={() => fileInputRef.current?.click()}
        className="rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[color:var(--accent-deep)]"
        data-testid="upload-button"
      >
        ↑ Upload
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          if (e.target.files) {
            onUpload(Array.from(e.target.files));
            e.target.value = ""; // allow same file re-select
          }
        }}
      />
      {creatingFolder ? (
        <form onSubmit={createFolder} className="flex items-center gap-2">
          <input
            type="text"
            autoFocus
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="folder name"
            className="rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-1.5 text-sm focus:border-[color:var(--accent)] focus:outline-none"
            data-testid="new-folder-input"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-sm text-white hover:bg-[color:var(--accent-deep)] disabled:opacity-50"
            data-testid="new-folder-submit"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatingFolder(false);
              setFolderName("");
            }}
            className="rounded-md border border-[color:var(--ink-trace)] px-3 py-1.5 text-sm hover:border-[color:var(--accent)]"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          onClick={() => setCreatingFolder(true)}
          className="rounded-md border border-[color:var(--ink-trace)] px-4 py-2 text-sm hover:border-[color:var(--accent)]"
          data-testid="new-folder-button"
        >
          + New folder
        </button>
      )}
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[color:var(--ink-soft)]">
        <input
          type="checkbox"
          checked={encryptUploads}
          onChange={(e) => onEncryptUploadsChange(e.target.checked)}
          data-testid="encrypt-toggle"
        />
        <span>🔒 Encrypt uploads</span>
      </label>
      <div className="ml-auto flex items-center gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search this folder…"
          className="rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-1.5 text-sm focus:border-[color:var(--accent)] focus:outline-none"
          data-testid="search-input"
        />
        <div
          className="inline-flex overflow-hidden rounded-md border border-[color:var(--ink-trace)]"
          role="group"
          aria-label="View mode"
        >
          <button
            onClick={() => onViewModeChange("list")}
            className={`px-3 py-1.5 text-xs ${viewMode === "list" ? "bg-[color:var(--accent)] text-white" : "hover:bg-[color:var(--paper-soft)]"}`}
            aria-pressed={viewMode === "list"}
            title="List view"
            data-testid="view-list"
          >
            ≡
          </button>
          <button
            onClick={() => onViewModeChange("grid")}
            className={`px-3 py-1.5 text-xs ${viewMode === "grid" ? "bg-[color:var(--accent)] text-white" : "hover:bg-[color:var(--paper-soft)]"}`}
            aria-pressed={viewMode === "grid"}
            title="Grid view"
            data-testid="view-grid"
          >
            ⊞
          </button>
        </div>
      </div>
    </div>
  );
}

function filterEntries(entries: PodEntry[], query: string): PodEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(q));
}

function Dropzone({
  onDrop,
  children,
}: {
  onDrop: (files: File[]) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setOver(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    if (e.currentTarget === e.target) setOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length > 0) {
      onDrop(Array.from(e.dataTransfer.files));
    }
  }
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`mt-2 rounded-md transition-all ${over ? "dropzone-active" : ""}`}
    >
      {children}
    </div>
  );
}

function UploadProgress({
  items,
}: {
  items: { name: string; done: number; total: number }[];
}) {
  return (
    <div
      className="mt-4 rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] p-3"
      data-testid="upload-progress"
    >
      <p
        className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        Uploading…
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((p) => {
          const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
          return (
            <li key={p.name} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate">{p.name}</span>
                <span className="mono text-xs text-[color:var(--ink-faint)]">{pct}%</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-[color:var(--paper-sunk)]">
                <div
                  className="h-1 rounded-full bg-[color:var(--accent)] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Listing({
  entries,
  driveRoot,
  containerUrl,
  onChanged,
  viewMode,
  searchQuery,
}: {
  entries: PodEntry[];
  driveRoot: string;
  containerUrl: string;
  onChanged: () => void;
  viewMode: ViewMode;
  searchQuery: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-[color:var(--ink-trace)] p-10 text-center text-[color:var(--ink-soft)]">
        {searchQuery ? (
          <>
            <p>No files match &quot;{searchQuery}&quot;.</p>
            <p className="mt-2 text-xs text-[color:var(--ink-faint)]">
              Search is filename-only inside the current folder for now.
            </p>
          </>
        ) : (
          <>
            <p>This folder is empty.</p>
            <p className="mt-2 text-xs text-[color:var(--ink-faint)]">
              Drop a file here, or use the Upload button above.
            </p>
          </>
        )}
      </div>
    );
  }
  if (viewMode === "grid") {
    return (
      <ul
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        data-testid="drive-listing"
      >
        {entries.map((entry) => (
          <Tile
            key={entry.url}
            entry={entry}
            driveRoot={driveRoot}
            containerUrl={containerUrl}
            onChanged={onChanged}
          />
        ))}
      </ul>
    );
  }
  return (
    <ul
      className="mt-4 divide-y divide-[color:var(--ink-trace)] rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper)]"
      data-testid="drive-listing"
    >
      {entries.map((entry) => (
        <Row
          key={entry.url}
          entry={entry}
          driveRoot={driveRoot}
          containerUrl={containerUrl}
          onChanged={onChanged}
        />
      ))}
    </ul>
  );
}

function Tile({
  entry,
  driveRoot,
  onChanged,
}: {
  entry: PodEntry;
  driveRoot: string;
  containerUrl: string;
  onChanged: () => void;
}) {
  const relPath = entry.url.slice(driveRoot.length);
  const href =
    entry.kind === "container"
      ? "/drive/" + relPath.replace(/\/$/, "")
      : "/drive/file/" + relPath;
  const [busy, setBusy] = useState(false);
  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete ${entry.name}${entry.kind === "container" ? "/" : ""}?`)) return;
    setBusy(true);
    try {
      await rmrf(entry.url);
      onChanged();
    } catch (err) {
      alert(`Delete failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li
      className="group relative overflow-hidden rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper)] hover:border-[color:var(--accent)]"
      data-testid={`tile-${entry.name}`}
    >
      <Link href={href} className="block">
        <div className="flex h-32 items-center justify-center bg-[color:var(--paper-sunk)]">
          {entry.kind === "container" ? (
            <span
              className="display text-3xl text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              /
            </span>
          ) : isImageName(entry.name) ? (
            <ImageThumbnail url={entry.url} alt={entry.name} className="h-32 w-full" />
          ) : (
            <span
              className="mono text-xs uppercase text-[color:var(--ink-soft)]"
              aria-hidden="true"
            >
              {extLabel(entry.name)}
            </span>
          )}
        </div>
        <div className="p-2">
          <p className="truncate text-sm">
            {entry.name}
            {entry.kind === "container" ? "/" : ""}
          </p>
          <p
            className="mono text-[10px] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {entry.size != null ? formatBytes(entry.size) : entry.kind === "container" ? "folder" : ""}
          </p>
        </div>
      </Link>
      <button
        onClick={onDelete}
        disabled={busy}
        title="Delete"
        className="absolute right-1 top-1 rounded bg-[color:var(--paper)]/80 px-1.5 py-0.5 text-xs text-[color:var(--status-bad)] opacity-0 backdrop-blur transition-opacity hover:bg-[color:var(--paper)] group-hover:opacity-100 disabled:opacity-50"
        data-testid={`tile-delete-${entry.name}`}
      >
        ×
      </button>
    </li>
  );
}

function Row({
  entry,
  driveRoot,
  onChanged,
}: {
  entry: PodEntry;
  driveRoot: string;
  containerUrl: string;
  onChanged: () => void;
}) {
  const relPath = entry.url.slice(driveRoot.length);
  const href =
    entry.kind === "container"
      ? "/drive/" + relPath.replace(/\/$/, "")
      : "/drive/file/" + relPath;
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(entry.name);

  async function onDelete() {
    const ok = window.confirm(`Delete ${entry.name}${entry.kind === "container" ? "/" : ""}?`);
    if (!ok) return;
    setBusy(true);
    try {
      await rmrf(entry.url);
      onChanged();
    } catch (err) {
      alert(`Delete failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    setBusy(true);
    try {
      const s = session();
      const res = await s.fetch(entry.url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entry.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert(`Download failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || trimmed === entry.name) {
      setRenaming(false);
      setNewName(entry.name);
      return;
    }
    if (entry.kind === "container") {
      alert("Container rename is not supported in M2 — copy/recreate manually.");
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      const parent = entry.url.slice(0, entry.url.lastIndexOf("/") + 1);
      const target = parent + encodeURIComponent(trimmed);
      await rename(entry.url, target);
      setRenaming(false);
      onChanged();
    } catch (err) {
      alert(`Rename failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="group flex items-center gap-4 px-4 py-3 hover:bg-[color:var(--paper-soft)]">
      <Icon kind={entry.kind} name={entry.name} />
      {renaming ? (
        <form onSubmit={onRenameSubmit} className="flex-1 flex items-center gap-2">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-md border border-[color:var(--accent)] bg-[color:var(--paper)] px-2 py-1 text-sm focus:outline-none"
            data-testid={`rename-input-${entry.name}`}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[color:var(--accent)] px-3 py-1 text-xs text-white hover:bg-[color:var(--accent-deep)] disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(false);
              setNewName(entry.name);
            }}
            className="rounded-md border border-[color:var(--ink-trace)] px-3 py-1 text-xs hover:border-[color:var(--accent)]"
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <Link
            href={href}
            className="flex-1 truncate text-sm hover:text-[color:var(--accent)]"
            data-testid={`entry-${entry.name}`}
          >
            {entry.name}
            {entry.kind === "container" ? "/" : ""}
          </Link>
          <span className="mono hidden w-24 text-right text-xs text-[color:var(--ink-faint)] sm:block">
            {entry.size != null
              ? formatBytes(entry.size)
              : entry.kind === "container"
              ? "—"
              : ""}
          </span>
          <span className="mono hidden w-40 text-right text-xs text-[color:var(--ink-faint)] sm:block">
            {entry.modified ? entry.modified.toLocaleString() : ""}
          </span>
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {entry.kind === "resource" ? (
              <button
                onClick={onDownload}
                disabled={busy}
                title="Download"
                className="rounded-md p-1.5 text-xs hover:bg-[color:var(--paper-sunk)] disabled:opacity-50"
                data-testid={`download-${entry.name}`}
              >
                ↓
              </button>
            ) : null}
            {entry.kind === "resource" ? (
              <button
                onClick={() => setRenaming(true)}
                disabled={busy}
                title="Rename"
                className="rounded-md p-1.5 text-xs hover:bg-[color:var(--paper-sunk)] disabled:opacity-50"
                data-testid={`rename-${entry.name}`}
              >
                ✎
              </button>
            ) : null}
            <button
              onClick={onDelete}
              disabled={busy}
              title="Delete"
              className="rounded-md p-1.5 text-xs text-[color:var(--status-bad)] hover:bg-[color:var(--paper-sunk)] disabled:opacity-50"
              data-testid={`delete-${entry.name}`}
            >
              ×
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function Icon({ kind, name }: { kind: "container" | "resource"; name: string }) {
  const label = kind === "container" ? "folder" : extLabel(name);
  return (
    <span
      className="mono inline-flex h-9 w-9 items-center justify-center rounded-md bg-[color:var(--paper-sunk)] text-[10px] uppercase text-[color:var(--ink-soft)]"
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

function extLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "file";
  const ext = name.slice(dot + 1).toLowerCase();
  return ext.slice(0, 4);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export { formatBytes, guessContentType };
