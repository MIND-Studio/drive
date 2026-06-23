"use client";

import { Button, Checkbox, Input, ToggleGroup, ToggleGroupItem } from "@mind-studio/ui";
import {
  ChevronRight,
  Download,
  Folder,
  FolderPlus,
  HardDrive,
  KeyRound,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import PassphraseDialog from "@/components/PassphraseDialog";
import { ImageThumbnail, isImageName } from "@/components/Thumbnail";
import VaultDialog from "@/components/VaultDialog";
import { driveRootFor, normalizeSegment } from "@/lib/config";
import { saveBlob } from "@/lib/download";
import { splitExt } from "@/lib/filename";
import { ensureSession, isEmbedded, rememberSignedOutPath } from "@/lib/solid/auth";
import { currentIdentity, isBrokered, signalReady } from "@/lib/solid/broker";
import {
  encryptFile,
  getSessionPassphrase,
  isEncryptedName,
  originalNameFromEnc,
  setSessionPassphrase,
  sidecarUrlFor,
} from "@/lib/solid/crypto";
import { renameFile } from "@/lib/solid/file-ops";
import {
  guessContentType,
  mkdir,
  type PodEntry,
  podFetch,
  readdir,
  rmrf,
  writeFileBlob,
} from "@/lib/solid/pod-fs";
import { addVaultEntries, isVaultName, type VaultEntry } from "@/lib/solid/vault";

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

export default function DriveBrowser({ pathSegments }: { pathSegments: string[] }) {
  const [state, setState] = useState<State>({ kind: "booting" });
  const [uploadProgress, setUploadProgress] = useState<
    { name: string; done: number; total: number }[]
  >([]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [encryptUploads, setEncryptUploads] = useState(false);
  const [passphrasePrompt, setPassphrasePrompt] = useState<null | {
    pendingFiles: File[];
    targetUrl: string;
    confirmRequired: boolean;
  }>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
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
    // Identity is brokered-first: inside the Mind shell it's the shell's webId
    // + workspace pod root (no local session); standalone it's the OIDC session.
    const id = currentIdentity();
    if (!id) {
      setState({ kind: "signed-out" });
      return;
    }
    const driveRoot = driveRootFor(id.podRoot);
    const containerUrl =
      pathSegments.length === 0
        ? driveRoot
        : driveRoot + pathSegments.map(normalizeSegment).join("/") + "/";
    try {
      const entries = await readdir(containerUrl);
      setState({
        kind: "ready",
        webId: id.webId,
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
            webId: id.webId,
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
      // Tell the shell we've rendered so it drops its loading overlay (no-op
      // when standalone).
      if (!cancelled && isBrokered()) signalReady();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const uploadFiles = useCallback(
    async (files: File[], targetUrl?: string) => {
      if (state.kind !== "ready" || files.length === 0) return;
      // targetUrl lets a drop onto a folder row upload INTO that folder; it
      // defaults to the folder currently being browsed.
      const containerUrl = targetUrl ?? state.containerUrl;

      if (encryptUploads && !getSessionPassphrase()) {
        // First encrypted upload of this session — collect a passphrase
        // before doing anything. The confirm-required flow doubles as a
        // typo guard since there's no recovery.
        setPassphrasePrompt({
          pendingFiles: files,
          targetUrl: containerUrl,
          confirmRequired: true,
        });
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
      const vaultEntries: VaultEntry[] = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          if (encryptUploads) {
            const passphrase = getSessionPassphrase();
            if (!passphrase) throw new Error("Missing session passphrase");
            const { ciphertext, sidecar } = await encryptFile(passphrase, f, f.name);
            const encUrl = containerUrl + encodeURIComponent(f.name) + ".enc";
            const metaUrl = sidecarUrlFor(encUrl);
            await writeFileBlob(encUrl, ciphertext, "application/octet-stream");
            const sidecarBlob = new Blob([JSON.stringify(sidecar)], {
              type: "application/json",
            });
            await writeFileBlob(metaUrl, sidecarBlob, "application/json");
            vaultEntries.push({
              fileUrl: encUrl,
              name: f.name,
              passphrase,
              addedAt: new Date().toISOString(),
            });
          } else {
            const url = containerUrl + encodeURIComponent(f.name);
            const contentType = f.type || guessContentType(f.name);
            await writeFileBlob(url, f, contentType);
          }
          setUploadProgress((prev) =>
            prev.map((p, idx) => (idx === i ? { ...p, done: p.total } : p)),
          );
        }
        // Record encrypted uploads in the in-pod vault so their passphrase is
        // recoverable and they're searchable there. Best-effort: a vault write
        // failure must never fail the upload itself.
        if (vaultEntries.length > 0) {
          const passphrase = getSessionPassphrase();
          if (passphrase) {
            try {
              await addVaultEntries(state.driveRoot, passphrase, vaultEntries);
            } catch (err) {
              console.warn("vault update failed", err);
            }
          }
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
    [refresh, state, encryptUploads],
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
      <Crumbs pathSegments={pathSegments} />
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
        onOpenVault={() => setVaultOpen(true)}
      />
      {uploadProgress.length > 0 ? <UploadProgress items={uploadProgress} /> : null}
      {uploadError ? (
        <div
          className="mt-4 flex items-start justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3"
          data-testid="upload-error-banner"
        >
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-destructive">
              Upload failed
            </p>
            <p className="mt-1 break-all font-mono text-xs text-foreground">{uploadError}</p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Common causes: signed-out session (re-login at /connect), the filename collides with
              an existing folder, or your pod denied the write.
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
          entries={filterEntries(hideInternalFiles(state.entries), searchQuery)}
          driveRoot={state.driveRoot}
          containerUrl={state.containerUrl}
          onChanged={refresh}
          onUploadToFolder={(url, files) => uploadFiles(files, url)}
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
            const { pendingFiles, targetUrl } = passphrasePrompt;
            setPassphrasePrompt(null);
            // re-trigger upload now that we have a passphrase
            void uploadFiles(pendingFiles, targetUrl);
          }}
          onCancel={() => setPassphrasePrompt(null)}
        />
      ) : null}
      {vaultOpen ? (
        <VaultDialog driveRoot={state.driveRoot} onClose={() => setVaultOpen(false)} />
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

function hideInternalFiles(entries: PodEntry[]): PodEntry[] {
  // The .enc.json sidecars and the encrypted vault file are implementation
  // details; surfacing them in the listing would be confusing. The matching
  // .enc rows already carry a 🔒 in their icon; the vault lives behind its
  // own dialog.
  return entries.filter((e) => !e.name.endsWith(".enc.json") && !isVaultName(safeDecode(e.name)));
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-5xl px-6 py-10 sm:px-10">{children}</section>;
}

function SignedOut() {
  const router = useRouter();
  // Remember the folder the user deep-linked to, so reconnecting returns here.
  // When hosted inside the Mind shell (embedded), skip this manual prompt and
  // go straight to /connect, which auto-starts the silent SSO sign-in — so
  // opening Drive in the shell lands on your files with no "connect" click.
  // (SignedOut only renders client-side, after the async session check, so
  // isEmbedded() is reliable here and there's no SSR/hydration mismatch.)
  useEffect(() => {
    rememberSignedOutPath();
    if (isEmbedded()) router.replace("/connect");
  }, [router]);

  if (isEmbedded()) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Connecting…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-8 text-center">
      <p className="text-2xl font-semibold tracking-tight">Connect your pod to see your drive.</p>
      <p className="mt-3 text-sm text-muted-foreground">
        Mind Drive only reads files you authorize. Sign in with your WebID to get started.
      </p>
      <Button asChild className="mt-6">
        <Link href="/connect">Connect a pod</Link>
      </Button>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
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

function Crumbs({ pathSegments }: { pathSegments: string[] }) {
  const crumbs = useMemo(() => {
    const acc: { label: string; href: string }[] = [{ label: "My Drive", href: "/drive" }];
    for (let i = 0; i < pathSegments.length; i++) {
      const slice = pathSegments.slice(0, i + 1);
      acc.push({
        label: safeDecode(pathSegments[i]),
        href: "/drive/" + slice.map(normalizeSegment).join("/"),
      });
    }
    return acc;
  }, [pathSegments]);

  const trail = crumbs.slice(0, -1);
  const current = crumbs[crumbs.length - 1];
  const atRoot = trail.length === 0;

  return (
    <div className="space-y-1.5">
      {trail.length > 0 ? (
        <nav
          className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
          aria-label="Breadcrumb"
        >
          {trail.map((c, i) => (
            <span key={c.href} className="flex items-center gap-1.5">
              {i > 0 ? <ChevronRight className="size-3 opacity-50" /> : null}
              <Link href={c.href} className="transition-colors hover:text-foreground">
                {c.label}
              </Link>
            </span>
          ))}
          <ChevronRight className="size-3 opacity-50" />
        </nav>
      ) : null}
      <div className="flex items-center gap-2.5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {atRoot ? <HardDrive className="size-4" /> : <Folder className="size-4" />}
        </span>
        <h1 className="truncate text-2xl font-semibold tracking-tight">{current.label}</h1>
      </div>
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
  onOpenVault,
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
  onOpenVault: () => void;
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
      toast.error(`Failed to create folder: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => fileInputRef.current?.click()} data-testid="upload-button">
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
          <Button type="submit" size="sm" disabled={busy} data-testid="new-folder-submit">
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
      <Button
        size="sm"
        variant="outline"
        onClick={onOpenVault}
        data-testid="vault-button"
        title="Passphrases for your encrypted files"
      >
        <KeyRound className="size-4" /> Vault
      </Button>
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

function UploadProgress({ items }: { items: { name: string; done: number; total: number }[] }) {
  return (
    <div className="mt-4 rounded-md border bg-muted/40 p-3" data-testid="upload-progress">
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
  onUploadToFolder,
  viewMode,
  searchQuery,
}: {
  entries: PodEntry[];
  driveRoot: string;
  containerUrl: string;
  onChanged: () => void;
  onUploadToFolder: (containerUrl: string, files: File[]) => void;
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
            onUploadToFolder={onUploadToFolder}
          />
        ))}
      </ul>
    );
  }
  return (
    <ul className="mt-4 divide-y rounded-md border bg-card" data-testid="drive-listing">
      {entries.map((entry) => (
        <Row
          key={entry.url}
          entry={entry}
          driveRoot={driveRoot}
          containerUrl={containerUrl}
          onChanged={onChanged}
          onUploadToFolder={onUploadToFolder}
        />
      ))}
    </ul>
  );
}

/**
 * Drag-and-drop handlers that let a folder row/tile accept files dropped onto
 * it, uploading INTO that folder. We stop propagation so the page-level
 * Dropzone (which uploads to the current folder) doesn't also fire. Non-folder
 * entries opt out, letting the event bubble to the page Dropzone.
 */
function useFolderDrop(
  isFolder: boolean,
  folderUrl: string,
  onUploadToFolder: (containerUrl: string, files: File[]) => void,
) {
  const [over, setOver] = useState(false);
  if (!isFolder) return { over: false, handlers: {} as Record<string, never> };
  return {
    over,
    handlers: {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (e.currentTarget === e.target) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (e.dataTransfer.files.length > 0) {
          onUploadToFolder(folderUrl, Array.from(e.dataTransfer.files));
        }
      },
    },
  };
}

function Tile({
  entry,
  driveRoot,
  onChanged,
  onUploadToFolder,
}: {
  entry: PodEntry;
  driveRoot: string;
  containerUrl: string;
  onChanged: () => void;
  onUploadToFolder: (containerUrl: string, files: File[]) => void;
}) {
  const relPath = entry.url.slice(driveRoot.length);
  const href =
    entry.kind === "container" ? "/drive/" + relPath.replace(/\/$/, "") : "/drive/file/" + relPath;
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { over: dropOver, handlers: dropHandlers } = useFolderDrop(
    entry.kind === "container",
    entry.url,
    onUploadToFolder,
  );
  async function doDelete() {
    setBusy(true);
    try {
      await rmrf(entry.url);
      // Encrypted files carry a sibling `.enc.json` sidecar (hidden from the
      // listing). Remove it too so deleting doesn't orphan it on the pod.
      if (isEncryptedName(entry.name)) {
        await rmrf(sidecarUrlFor(entry.url)).catch(() => {});
      }
      onChanged();
    } catch (err) {
      toast.error(`Delete failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }
  const isContainer = entry.kind === "container";
  return (
    <li
      {...dropHandlers}
      className={`group relative overflow-hidden rounded-md border bg-card transition-colors hover:border-primary ${
        dropOver ? "border-primary ring-2 ring-primary" : ""
      }`}
      data-testid={`tile-${entry.name}`}
    >
      <Link href={href} className="block">
        <div className="flex h-32 items-center justify-center bg-muted">
          {entry.kind === "container" ? (
            <Folder className="size-10 text-muted-foreground" />
          ) : isImageName(entry.name) ? (
            <ImageThumbnail url={entry.url} alt={entry.name} className="h-32 w-full" />
          ) : (
            <span className="font-mono text-xs uppercase text-muted-foreground" aria-hidden="true">
              {extLabel(entry.name)}
            </span>
          )}
        </div>
        <div className="p-2">
          <p className="truncate text-sm">
            {displayName(entry.name)}
            {entry.kind === "container" ? "/" : ""}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {entry.size != null
              ? formatBytes(entry.size)
              : entry.kind === "container"
                ? "folder"
                : ""}
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
        className="absolute right-1 top-1 bg-card/80 text-destructive opacity-100 backdrop-blur transition-opacity hover:bg-card hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
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
  onUploadToFolder,
}: {
  entry: PodEntry;
  driveRoot: string;
  containerUrl: string;
  onChanged: () => void;
  onUploadToFolder: (containerUrl: string, files: File[]) => void;
}) {
  const relPath = entry.url.slice(driveRoot.length);
  const href =
    entry.kind === "container" ? "/drive/" + relPath.replace(/\/$/, "") : "/drive/file/" + relPath;
  const isContainer = entry.kind === "container";
  // The user-facing name (decoded; encrypted files show their original name).
  const displayedName = isEncryptedName(safeDecode(entry.name))
    ? originalNameFromEnc(safeDecode(entry.name))
    : safeDecode(entry.name);
  // Renames edit the base only; the extension is locked so the format can't change.
  const { base, ext } = splitExt(displayedName);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newBase, setNewBase] = useState(base);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { over: dropOver, handlers: dropHandlers } = useFolderDrop(
    isContainer,
    entry.url,
    onUploadToFolder,
  );
  const isImage = entry.kind === "resource" && isImageName(safeDecode(entry.name));

  async function doDelete() {
    setBusy(true);
    try {
      await rmrf(entry.url);
      // Encrypted files carry a sibling `.enc.json` sidecar (hidden from the
      // listing). Remove it too so deleting doesn't orphan it on the pod.
      if (isEncryptedName(entry.name)) {
        await rmrf(sidecarUrlFor(entry.url)).catch(() => {});
      }
      onChanged();
    } catch (err) {
      toast.error(`Delete failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    setBusy(true);
    try {
      const res = await podFetch()(entry.url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      saveBlob(blob, safeDecode(entry.name));
    } catch (err) {
      toast.error(`Download failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextDisplay = newBase.trim() + ext;
    if (!newBase.trim() || nextDisplay === displayedName) {
      setRenaming(false);
      setNewBase(base);
      return;
    }
    if (entry.kind === "container") {
      toast.error("Container rename is not supported in M2 — copy/recreate manually.");
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      await renameFile({ fromUrl: entry.url, newDisplayName: nextDisplay });
      setRenaming(false);
      onChanged();
    } catch (err) {
      toast.error(`Rename failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      {...dropHandlers}
      className={`group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50 ${
        dropOver ? "bg-primary/5 ring-2 ring-inset ring-primary" : ""
      }`}
    >
      {isImage ? (
        <span className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          <ImageThumbnail url={entry.url} alt={displayedName} className="size-9" />
        </span>
      ) : (
        <Icon kind={entry.kind} name={entry.name} />
      )}
      {renaming ? (
        <form onSubmit={onRenameSubmit} className="flex-1 flex items-center gap-2">
          <Input
            type="text"
            autoFocus
            value={newBase}
            onChange={(e) => setNewBase(e.target.value)}
            className="h-8 flex-1"
            data-testid={`rename-input-${entry.name}`}
          />
          {ext ? (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{ext}</span>
          ) : null}
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setRenaming(false);
              setNewBase(base);
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
            {displayName(entry.name)}
            {entry.kind === "container" ? "/" : ""}
          </Link>
          <span className="hidden w-24 text-right font-mono text-xs text-muted-foreground sm:block">
            {entry.size != null ? formatBytes(entry.size) : entry.kind === "container" ? "—" : ""}
          </span>
          <span className="hidden w-40 text-right font-mono text-xs text-muted-foreground sm:block">
            {entry.modified ? entry.modified.toLocaleString() : ""}
          </span>
          <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
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

// Encrypted files are stored as `<name>.enc` on the pod, but that suffix is an
// implementation detail (same reasoning as hiding the `.enc.json` sidecars).
// Present them with their original name + a lock, matching the file viewer.
// Names are URL segments, so percent-decode for display (like the breadcrumbs):
// `Shared%20Demo` reads as "Shared Demo".
function displayName(name: string): string {
  const n = safeDecode(name);
  return isEncryptedName(n) ? `🔒 ${originalNameFromEnc(n)}` : n;
}

function extLabel(name: string): string {
  const base = isEncryptedName(name) ? originalNameFromEnc(name) : name;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "file";
  const ext = base.slice(dot + 1).toLowerCase();
  return ext.slice(0, 4);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export { formatBytes, guessContentType };
