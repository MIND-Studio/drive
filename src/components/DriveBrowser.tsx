"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Button,
  Input,
  Checkbox,
  ToggleGroup,
  ToggleGroupItem,
} from "@mind-studio/ui";
import {
  Upload,
  FolderPlus,
  List as ListIcon,
  LayoutGrid,
  Download,
  Pencil,
  Trash2,
  X,
  Folder,
} from "lucide-react";
import { session } from "@/lib/solid/session";
import { ensureSession, rememberSignedOutPath } from "@/lib/solid/auth";
import { ImageThumbnail, isImageName } from "@/components/Thumbnail";
import PassphraseDialog from "@/components/PassphraseDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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
          className="mt-4 flex items-start justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3"
          data-testid="upload-error-banner"
        >
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-destructive">
              Upload failed
            </p>
            <p className="mt-1 break-all font-mono text-xs text-foreground">
              {uploadError}
            </p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Common causes: signed-out session (re-login at /connect), the
              filename collides with an existing folder, or your pod denied the
              write.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setUploadError(null)}
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </Button>
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
  // Remember the folder the user deep-linked to, so reconnecting returns here.
  useEffect(() => rememberSignedOutPath(), []);
  return (
    <div className="rounded-lg border bg-card p-8 text-center">
      <p className="text-2xl font-semibold tracking-tight">
        Connect your pod to see your drive.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Mind Drive only reads files you authorize. Sign in with your WebID to
        get started.
      </p>
      <Button asChild className="mt-6">
        <Link href="/connect">Connect a pod</Link>
      </Button>
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
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-destructive">
        Pod error
      </p>
      <p className="mt-2 break-all font-mono text-sm">{message}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Retry
      </Button>
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
              {i > 0 ? <span className="text-muted-foreground">/</span> : null}
              {isLast ? (
                <span className="text-2xl font-semibold tracking-tight">
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="text-muted-foreground hover:text-primary"
                >
                  {c.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
      <p
        className="hidden font-mono text-xs text-muted-foreground sm:block"
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
      <Button
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        data-testid="upload-button"
      >
        <Upload className="size-4" /> Upload
      </Button>
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
          <Input
            type="text"
            autoFocus
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="folder name"
            className="h-8 w-44"
            data-testid="new-folder-input"
          />
          <Button
            type="submit"
            size="sm"
            disabled={busy}
            data-testid="new-folder-submit"
          >
            Create
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setCreatingFolder(false);
              setFolderName("");
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCreatingFolder(true)}
          data-testid="new-folder-button"
        >
          <FolderPlus className="size-4" /> New folder
        </Button>
      )}
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <Checkbox
          checked={encryptUploads}
          onCheckedChange={(v) => onEncryptUploadsChange(v === true)}
          data-testid="encrypt-toggle"
        />
        <span>🔒 Encrypt uploads</span>
      </label>
      <div className="ml-auto flex items-center gap-2">
        <Input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search this folder…"
          className="h-8 w-48"
          data-testid="search-input"
        />
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => {
            if (v === "list" || v === "grid") onViewModeChange(v);
          }}
          variant="outline"
          size="sm"
          aria-label="View mode"
        >
          <ToggleGroupItem value="list" title="List view" data-testid="view-list">
            <ListIcon className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" title="Grid view" data-testid="view-grid">
            <LayoutGrid className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
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
      className="mt-4 rounded-md border bg-muted/40 p-3"
      data-testid="upload-progress"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Uploading…
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((p) => {
          const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
          return (
            <li key={p.name} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate">{p.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{pct}%</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-muted">
                <div
                  className="h-1 rounded-full bg-primary transition-all"
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
      <div className="mt-4 rounded-md border border-dashed p-10 text-center text-muted-foreground">
        {searchQuery ? (
          <>
            <p>No files match &quot;{searchQuery}&quot;.</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Search is filename-only inside the current folder for now.
            </p>
          </>
        ) : (
          <>
            <p>This folder is empty.</p>
            <p className="mt-2 text-xs text-muted-foreground">
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
      className="mt-4 divide-y rounded-md border bg-card"
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  async function doDelete() {
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
  const isContainer = entry.kind === "container";
  return (
    <li
      className="group relative overflow-hidden rounded-md border bg-card transition-colors hover:border-primary"
      data-testid={`tile-${entry.name}`}
    >
      <Link href={href} className="block">
        <div className="flex h-32 items-center justify-center bg-muted">
          {entry.kind === "container" ? (
            <Folder className="size-10 text-muted-foreground" />
          ) : isImageName(entry.name) ? (
            <ImageThumbnail url={entry.url} alt={entry.name} className="h-32 w-full" />
          ) : (
            <span
              className="font-mono text-xs uppercase text-muted-foreground"
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
          <p className="font-mono text-[10px] text-muted-foreground">
            {entry.size != null ? formatBytes(entry.size) : entry.kind === "container" ? "folder" : ""}
          </p>
        </div>
      </Link>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirmOpen(true);
        }}
        disabled={busy}
        title="Delete"
        className="absolute right-1 top-1 bg-card/80 text-destructive opacity-0 backdrop-blur transition-opacity hover:bg-card hover:text-destructive group-hover:opacity-100"
        data-testid={`tile-delete-${entry.name}`}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${entry.name}${isContainer ? "/" : ""}?`}
        description={
          isContainer
            ? "This deletes the folder and everything inside it from your pod. Solid has no trash — this can't be undone."
            : "This permanently deletes the file from your pod. Solid has no trash — this can't be undone."
        }
        onConfirm={doDelete}
      />
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isContainer = entry.kind === "container";

  async function doDelete() {
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
    <li className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
      <Icon kind={entry.kind} name={entry.name} />
      {renaming ? (
        <form onSubmit={onRenameSubmit} className="flex-1 flex items-center gap-2">
          <Input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8 flex-1"
            data-testid={`rename-input-${entry.name}`}
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
              setNewName(entry.name);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <Link
            href={href}
            className="flex-1 truncate text-sm hover:text-primary"
            data-testid={`entry-${entry.name}`}
          >
            {entry.name}
            {entry.kind === "container" ? "/" : ""}
          </Link>
          <span className="hidden w-24 text-right font-mono text-xs text-muted-foreground sm:block">
            {entry.size != null
              ? formatBytes(entry.size)
              : entry.kind === "container"
              ? "—"
              : ""}
          </span>
          <span className="hidden w-40 text-right font-mono text-xs text-muted-foreground sm:block">
            {entry.modified ? entry.modified.toLocaleString() : ""}
          </span>
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {entry.kind === "resource" ? (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onDownload}
                disabled={busy}
                title="Download"
                data-testid={`download-${entry.name}`}
              >
                <Download className="size-4" />
              </Button>
            ) : null}
            {entry.kind === "resource" ? (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setRenaming(true)}
                disabled={busy}
                title="Rename"
                data-testid={`rename-${entry.name}`}
              >
                <Pencil className="size-4" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setConfirmOpen(true)}
              disabled={busy}
              title="Delete"
              className="text-destructive hover:text-destructive"
              data-testid={`delete-${entry.name}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${entry.name}${isContainer ? "/" : ""}?`}
        description={
          isContainer
            ? "This deletes the folder and everything inside it from your pod. Solid has no trash — this can't be undone."
            : "This permanently deletes the file from your pod. Solid has no trash — this can't be undone."
        }
        onConfirm={doDelete}
      />
    </li>
  );
}

function Icon({ kind, name }: { kind: "container" | "resource"; name: string }) {
  if (kind === "container") {
    return (
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Folder className="size-4" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-muted font-mono text-[10px] uppercase text-muted-foreground"
      aria-hidden="true"
    >
      {extLabel(name)}
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
