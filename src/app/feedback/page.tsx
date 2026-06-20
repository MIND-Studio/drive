"use client";

import type {
  FeedbackEntry,
  FeedbackKind,
  FeedbackStatus,
  Sentiment,
} from "@mind-studio/core/feedback";
import {
  ensureFeedbackInbox,
  FEEDBACK_STATUSES,
  readFeedback,
  setFeedbackStatus,
} from "@mind-studio/core/feedback";
import { Button } from "@mind-studio/ui";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { FeedbackBoard, STATUS_META, StatusControl } from "@/components/FeedbackBoard";
import { feedbackInbox } from "@/lib/config";
import { ensureSession, rememberSignedOutPath } from "@/lib/solid/auth";
import { podFetch } from "@/lib/solid/pod-fs";

const FACE: Record<Sentiment, string> = { bad: "😞", meh: "😐", good: "🙂", love: "😍" };
const KIND_ICON: Record<FeedbackKind, string> = {
  bug: "🐞",
  idea: "💡",
  praise: "🎉",
  other: "💬",
};

function shortName(webId: string): string {
  try {
    const parts = new URL(webId).pathname.split("/").filter(Boolean);
    return parts[0] ?? webId;
  } catch {
    return webId;
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown time";
  const s = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(s);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return fmt.format(Math.round(s), "second");
  if (abs < 3600) return fmt.format(Math.round(s / 60), "minute");
  if (abs < 86400) return fmt.format(Math.round(s / 3600), "hour");
  return fmt.format(Math.round(s / 86400), "day");
}

export default function FeedbackInboxPage() {
  const [webId, setWebId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Append-only inboxes return 401/403 on read to non-owners. Distinguish that
  // from a genuinely empty inbox so the empty state tells the truth.
  const [access, setAccess] = useState<"ok" | "denied">("ok");
  // URLs whose status write-back is in flight (disables their status control).
  const [busyUrls, setBusyUrls] = useState<Set<string>>(new Set());

  const [view, setView] = useState<"list" | "board">("list");
  const [kindFilter, setKindFilter] = useState<FeedbackKind | "all">("all");
  const [sentFilter, setSentFilter] = useState<Sentiment | "all">("all");
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");

  useEffect(() => {
    ensureSession()
      .then((info) => setWebId(info.webId ?? null))
      .catch(() => setWebId(null))
      .finally(() => setReady(true));
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setAccess("ok");
    const fetcher = podFetch();
    try {
      // Probe first: a non-owner gets 401/403 on the container (append-only),
      // which readFeedback would otherwise swallow into an empty list.
      let probe = await fetcher(feedbackInbox, { method: "GET" });
      // Signed-in owner, but the inbox has never been set up (the container
      // 404s): provision it now — create the container + append-only ACL — so
      // feedback can actually be submitted. Without this nobody can send any.
      if (probe.status === 404 && webId) {
        await ensureFeedbackInbox(feedbackInbox, fetcher, webId);
        probe = await fetcher(feedbackInbox, { method: "GET" });
      }
      if (probe.status === 401 || probe.status === 403) {
        setAccess("denied");
        setEntries([]);
        // Signed-out owner: capture /feedback so a subsequent /connect login
        // returns here (with the session) instead of the default /drive.
        rememberSignedOutPath();
        return;
      }
      const list = await readFeedback(feedbackInbox, fetcher);
      setEntries(list); // oldest → newest; sort applied in view
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [webId]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // Owner-only triage write-back, optimistic with rollback on failure.
  const updateStatus = useCallback(async (entry: FeedbackEntry, next: FeedbackStatus) => {
    if (entry.status === next) return;
    const prev = entry.status;
    setEntries((list) => list.map((e) => (e.url === entry.url ? { ...e, status: next } : e)));
    setBusyUrls((s) => new Set(s).add(entry.url));
    try {
      await setFeedbackStatus(entry.url, next, podFetch());
    } catch (err) {
      setEntries((list) => list.map((e) => (e.url === entry.url ? { ...e, status: prev } : e)));
      setError(`Couldn't update status: ${(err as Error).message}`);
    } finally {
      setBusyUrls((s) => {
        const n = new Set(s);
        n.delete(entry.url);
        return n;
      });
    }
  }, []);

  const stats = useMemo(() => {
    const bySentiment: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const e of entries) {
      bySentiment[e.sentiment] = (bySentiment[e.sentiment] ?? 0) + 1;
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    }
    return { bySentiment, byKind, byStatus, total: entries.length };
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = entries.filter((e) => {
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (sentFilter !== "all" && e.sentiment !== sentFilter) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (q) {
        const hay = `${e.comment} ${e.route} ${e.webId ?? ""} ${e.clientErrors}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return sort === "newest" ? out.slice().reverse() : out;
  }, [entries, kindFilter, sentFilter, statusFilter, query, sort]);

  function exportJson() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drive-feedback-${filtered.length}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeFilters =
    kindFilter !== "all" || sentFilter !== "all" || statusFilter !== "all" || query.trim() !== "";

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">feedback inbox</h1>
          <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {feedbackInbox}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border">
            <button
              type="button"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
              className={
                "px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider " +
                (view === "list" ? "bg-primary/15 text-primary" : "text-muted-foreground")
              }
            >
              ☰ list
            </button>
            <button
              type="button"
              aria-pressed={view === "board"}
              onClick={() => setView("board")}
              className={
                "px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider " +
                (view === "board" ? "bg-primary/15 text-primary" : "text-muted-foreground")
              }
            >
              ▦ board
            </button>
          </div>
          {entries.length > 0 && view === "list" && (
            <Button
              variant="ghost"
              size="sm"
              title="Toggle sort order"
              onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
            >
              {sort === "newest" ? "↓ newest" : "↑ oldest"}
            </Button>
          )}
          {entries.length > 0 && (
            <Button variant="ghost" size="sm" title="Download as JSON" onClick={exportJson}>
              ⤓ export
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
            {busy ? "…" : "↻ Refresh"}
          </Button>
        </div>
      </header>

      {/* Stats */}
      <section className="mb-4 flex flex-wrap gap-2">
        <Stat label="total" value={stats.total} />
        {FEEDBACK_STATUSES.map((s) =>
          stats.byStatus[s] ? (
            <Stat
              key={s}
              label={`${STATUS_META[s].icon} ${STATUS_META[s].label.toLowerCase()}`}
              value={stats.byStatus[s]}
            />
          ) : null,
        )}
      </section>

      {/* Filters */}
      {stats.total > 0 && (
        <section className="mb-5 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={kindFilter === "all"} onClick={() => setKindFilter("all")}>
              all
            </FilterChip>
            {(["bug", "idea", "praise", "other"] as FeedbackKind[]).map((k) =>
              stats.byKind[k] ? (
                <FilterChip
                  key={k}
                  active={kindFilter === k}
                  onClick={() => setKindFilter(kindFilter === k ? "all" : k)}
                >
                  {KIND_ICON[k]} {k} ({stats.byKind[k]})
                </FilterChip>
              ) : null,
            )}
            <span className="mx-1 text-muted-foreground">·</span>
            {(["love", "good", "meh", "bad"] as Sentiment[]).map((s) =>
              stats.bySentiment[s] ? (
                <FilterChip
                  key={s}
                  active={sentFilter === s}
                  onClick={() => setSentFilter(sentFilter === s ? "all" : s)}
                >
                  {FACE[s]}
                </FilterChip>
              ) : null,
            )}
            <span className="mx-1 text-muted-foreground">·</span>
            {FEEDBACK_STATUSES.map((s) =>
              stats.byStatus[s] ? (
                <FilterChip
                  key={s}
                  active={statusFilter === s}
                  onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                >
                  {STATUS_META[s].icon} {STATUS_META[s].label.toLowerCase()} ({stats.byStatus[s]})
                </FilterChip>
              ) : null,
            )}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search comments, routes, authors, errors…"
            aria-label="Search feedback"
            data-testid="feedback-search"
            className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
        </section>
      )}

      {error && (
        <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-4 py-2 font-mono text-[11px] text-destructive">
          ⚠ {error}
        </div>
      )}

      {busy ? (
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          // reading inbox…
        </p>
      ) : access === "denied" && !webId ? (
        // Signed out: a hard load can't keep the in-memory session (drive
        // deliberately avoids restorePreviousSession — see auth.ts), so the
        // owner lands here signed-out. Offer the way back in rather than
        // dead-ending. /connect honours the remembered return path, so login
        // SPA-lands back here with the session intact.
        <div className="rounded-xl border border-dashed px-6 py-12 text-center">
          <div className="text-3xl">🔑</div>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to read your feedback inbox.</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Only the inbox owner can read submissions.
          </p>
          <Button asChild className="mt-4">
            <Link href="/connect">Connect a pod</Link>
          </Button>
        </div>
      ) : access === "denied" ? (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center">
          <div className="text-3xl">🔒</div>
          <p className="mt-2 text-sm text-muted-foreground">
            You don&apos;t have read access to this inbox.
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            It&apos;s append-only: anyone can submit, but only the owner can read.
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-12 text-center">
          <div className="text-3xl">📭</div>
          <p className="mt-2 text-sm text-muted-foreground">No feedback yet.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">No matches for the current filters.</p>
          <button
            type="button"
            onClick={() => {
              setKindFilter("all");
              setSentFilter("all");
              setStatusFilter("all");
              setQuery("");
            }}
            className="mt-2 font-mono text-[11px] uppercase tracking-wider text-primary hover:underline"
          >
            clear filters
          </button>
        </div>
      ) : view === "board" ? (
        <FeedbackBoard entries={filtered} onStatus={updateStatus} busyUrls={busyUrls} />
      ) : (
        <>
          {activeFilters && (
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              showing {filtered.length} of {stats.total}
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {filtered.map((e) => (
              <EntryCard
                key={e.id}
                e={e}
                busy={busyUrls.has(e.url)}
                onStatus={(next) => updateStatus(e, next)}
              />
            ))}
          </ul>
        </>
      )}

      <footer className="mt-10 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <Link href="/drive" className="underline-offset-2 hover:text-primary hover:underline">
          ← back to drive
        </Link>
        {webId && <span className="ml-3 opacity-60">· {shortName(webId)}</span>}
      </footer>
    </main>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        "rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors " +
        (active
          ? "border-primary bg-primary/15 text-primary"
          : "text-muted-foreground hover:border-primary")
      }
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>{" "}
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function EntryCard({
  e,
  onStatus,
  busy,
}: {
  e: FeedbackEntry;
  onStatus: (next: FeedbackStatus) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasDetail = !!(
    e.userAgent ||
    e.appVersion ||
    e.clientErrors ||
    e.screenshot ||
    e.voiceNote ||
    e.target
  );

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(e, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="text-xl" title={e.sentiment}>
          {FACE[e.sentiment]}
        </span>
        <span className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider">
          {KIND_ICON[e.kind]} {e.kind}
        </span>
        {e.clientErrors && (
          <span
            className="rounded-full border border-destructive/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-destructive"
            title="Client errors attached"
          >
            🐞 error
          </span>
        )}
        {e.voiceNote && (
          <span
            className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            title="Voice note attached"
          >
            🎤 voice
          </span>
        )}
        {e.target && (
          <span
            className="rounded-full border border-primary/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary"
            title={`Targets: ${e.target.selector}`}
          >
            🎯 {e.target.label}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <StatusControl value={e.status} onChange={onStatus} busy={busy} />
          <span
            className="font-mono text-[10px] text-muted-foreground"
            title={e.createdAt ?? undefined}
          >
            {e.createdAt ? relativeTime(e.createdAt) : "unknown time"}
          </span>
        </span>
      </div>

      {e.comment ? (
        <Link href={`/feedback/${encodeURIComponent(e.id)}`} className="mt-2 block">
          <p className="whitespace-pre-wrap text-sm hover:text-primary">{e.comment}</p>
        </Link>
      ) : (
        <Link
          href={`/feedback/${encodeURIComponent(e.id)}`}
          className="mt-2 block text-sm italic text-muted-foreground hover:text-primary"
        >
          (no comment)
        </Link>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
        {e.route && <span>route: {e.route}</span>}
        <span>by: {e.webId ? shortName(e.webId) : "anonymous"}</span>
        {e.viewport && <span>{e.viewport}</span>}
        <span className="ml-auto flex items-center gap-2">
          <Link
            href={`/feedback/${encodeURIComponent(e.id)}`}
            className="uppercase tracking-wider hover:text-primary"
          >
            detail →
          </Link>
          <button
            type="button"
            onClick={copyJson}
            className="uppercase tracking-wider hover:text-primary"
          >
            {copied ? "copied ✓" : "copy json"}
          </button>
          {hasDetail && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="uppercase tracking-wider hover:text-primary"
            >
              {open ? "less ▲" : "details ▾"}
            </button>
          )}
        </span>
      </div>

      {open && e.voiceNote && <audio src={e.voiceNote} controls className="mt-3 h-9 w-full" />}

      {open && hasDetail && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 font-mono text-[10px] text-muted-foreground">
          {e.webId && (
            <>
              <dt className="opacity-70">webid</dt>
              <dd className="break-all">{e.webId}</dd>
            </>
          )}
          {e.appVersion && (
            <>
              <dt className="opacity-70">version</dt>
              <dd>{e.appVersion}</dd>
            </>
          )}
          {e.userAgent && (
            <>
              <dt className="opacity-70">agent</dt>
              <dd className="break-all">{e.userAgent}</dd>
            </>
          )}
          {e.screenshot && (
            <>
              <dt className="opacity-70">shot</dt>
              <dd>
                <a
                  href={e.screenshot}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  open screenshot
                </a>
              </dd>
            </>
          )}
          {e.target && (
            <>
              <dt className="opacity-70">element</dt>
              <dd className="break-all">
                🎯 {e.target.label}
                <span className="opacity-60"> — {e.target.selector}</span>
                {e.target.text ? <span className="opacity-60"> · “{e.target.text}”</span> : null}
                <span className="opacity-50">
                  {" "}
                  · {e.target.rect.w}×{e.target.rect.h} @ {e.target.rect.x},{e.target.rect.y}
                </span>
              </dd>
            </>
          )}
        </dl>
      )}

      {open && e.clientErrors && (
        <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono text-[10px] text-destructive">
          {e.clientErrors}
        </pre>
      )}
    </li>
  );
}
