"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@mind-studio/ui";
import { Copy, ExternalLink, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { getSessionPassphrase, setSessionPassphrase } from "@/lib/solid/crypto";
import { loadVault, searchVaultEntries, type VaultEntry } from "@/lib/solid/vault";

/**
 * The passphrase vault: an in-pod, encrypted index of the files you've
 * encrypted, linking each to the passphrase that opens it. Unlocked with the
 * same passphrase used to encrypt this session's files; if one is already held
 * in memory the vault opens straight away.
 */
export default function VaultDialog({
  driveRoot,
  onClose,
}: {
  driveRoot: string;
  onClose: () => void;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [pass, setPass] = useState("");
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const open = useCallback(
    async (passphrase: string) => {
      setBusy(true);
      setError(null);
      try {
        const data = await loadVault(driveRoot, passphrase);
        setEntries(data.entries.slice().reverse()); // newest first
        setUnlocked(true);
        setSessionPassphrase(passphrase);
      } catch {
        setError("Wrong passphrase, or the vault couldn't be opened.");
      } finally {
        setBusy(false);
      }
    },
    [driveRoot],
  );

  // If a passphrase is already in memory (e.g. after an encrypted upload), open
  // the vault without re-prompting.
  useEffect(() => {
    const existing = getSessionPassphrase();
    if (existing) void open(existing);
  }, [open]);

  const filtered = searchVaultEntries(entries, query);

  function toggleReveal(fileUrl: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(fileUrl)) next.delete(fileUrl);
      else next.add(fileUrl);
      return next;
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="vault-dialog">
        <DialogHeader>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Vault
          </p>
          <DialogTitle>Encrypted files</DialogTitle>
          <DialogDescription>
            Passphrases for the files you've encrypted — stored encrypted in your own pod, never on
            our servers.
          </DialogDescription>
        </DialogHeader>

        {!unlocked ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pass.trim()) void open(pass);
            }}
            className="space-y-3"
          >
            <Label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Vault passphrase
            </Label>
            <Input
              type="password"
              autoFocus
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="Your encryption passphrase"
              data-testid="vault-passphrase"
            />
            <Button type="submit" disabled={busy || !pass.trim()} data-testid="vault-unlock">
              {busy ? "Opening…" : "Unlock vault"}
            </Button>
            {error ? (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        ) : (
          <div className="space-y-3">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vault…"
              data-testid="vault-search"
            />
            {filtered.length === 0 ? (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {entries.length === 0
                  ? "No encrypted files yet. Turn on “🔒 Encrypt uploads” and upload a file."
                  : "No entries match your search."}
              </p>
            ) : (
              <ul className="max-h-[50vh] space-y-2 overflow-auto" data-testid="vault-list">
                {filtered.map((entry) => (
                  <VaultRow
                    key={entry.fileUrl}
                    entry={entry}
                    driveRoot={driveRoot}
                    revealed={revealed.has(entry.fileUrl)}
                    onToggle={() => toggleReveal(entry.fileUrl)}
                    onOpenFile={onClose}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VaultRow({
  entry,
  driveRoot,
  revealed,
  onToggle,
  onOpenFile,
}: {
  entry: VaultEntry;
  driveRoot: string;
  revealed: boolean;
  onToggle: () => void;
  onOpenFile: () => void;
}) {
  const rel = entry.fileUrl.startsWith(driveRoot) ? entry.fileUrl.slice(driveRoot.length) : null;
  const href = rel ? `/drive/file/${rel}` : null;
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    const ok = await copyText(entry.passphrase);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <li className="rounded-md border bg-muted/40 p-3" data-testid={`vault-entry-${entry.name}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">🔒 {entry.name}</span>
        {href ? (
          <Link
            href={href}
            onClick={onOpenFile}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
          >
            Open <ExternalLink className="size-3" />
          </Link>
        ) : null}
      </div>
      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
        added {new Date(entry.addedAt).toLocaleString()}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-background px-2 py-1 font-mono text-xs">
          {revealed ? entry.passphrase : "••••••••••"}
        </code>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          title={revealed ? "Hide passphrase" : "Reveal passphrase"}
        >
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onCopy} title="Copy passphrase">
          <Copy className={`size-4 ${copied ? "text-primary" : ""}`} />
        </Button>
      </div>
    </li>
  );
}
