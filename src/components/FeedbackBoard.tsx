"use client";

import Link from "next/link";
import type {
  FeedbackEntry,
  FeedbackStatus,
  Sentiment,
  FeedbackKind,
} from "@mind-studio/core/feedback";
import { FEEDBACK_STATUSES } from "@mind-studio/core/feedback";

const FACE: Record<Sentiment, string> = {
  bad: "😞",
  meh: "😐",
  good: "🙂",
  love: "😍",
};
const KIND_ICON: Record<FeedbackKind, string> = {
  bug: "🐞",
  idea: "💡",
  praise: "🎉",
  other: "💬",
};

/** Triage states, shared between the inbox list and the board. */
export const STATUS_META: Record<
  FeedbackStatus,
  { label: string; icon: string }
> = {
  new: { label: "New", icon: "🆕" },
  "in-progress": { label: "In progress", icon: "🔧" },
  done: { label: "Done", icon: "✅" },
  wontfix: { label: "Won't fix", icon: "🚫" },
};

/** Compact `<select>` for moving a record between triage states. */
export function StatusControl({
  value,
  onChange,
  busy,
}: {
  value: FeedbackStatus;
  onChange: (next: FeedbackStatus) => void;
  busy?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={busy}
      aria-label="Triage status"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as FeedbackStatus)}
      className="rounded-full border bg-background px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground outline-none focus:border-primary disabled:opacity-50"
    >
      {FEEDBACK_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_META[s].icon} {STATUS_META[s].label}
        </option>
      ))}
    </select>
  );
}

/**
 * Kanban board: one column per triage state. Entries are grouped by `status`;
 * changing a card's status (via its `StatusControl`) moves it to another column
 * — the status write-back happens in the parent's `onStatus` handler.
 */
export function FeedbackBoard({
  entries,
  onStatus,
  busyUrls,
}: {
  entries: FeedbackEntry[];
  onStatus: (entry: FeedbackEntry, next: FeedbackStatus) => void;
  busyUrls: Set<string>;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {FEEDBACK_STATUSES.map((s) => {
        const col = entries.filter((e) => e.status === s);
        return (
          <div
            key={s}
            className="flex min-w-[14rem] flex-1 flex-col gap-2 rounded-xl border bg-muted/30 p-2"
          >
            <div className="flex items-center justify-between px-1 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>
                {STATUS_META[s].icon} {STATUS_META[s].label}
              </span>
              <span className="opacity-60">{col.length}</span>
            </div>
            {col.map((e) => (
              <BoardCard
                key={e.id}
                e={e}
                busy={busyUrls.has(e.url)}
                onStatus={(next) => onStatus(e, next)}
              />
            ))}
            {col.length === 0 && (
              <p className="px-1 py-3 text-center font-mono text-[10px] text-muted-foreground opacity-50">
                —
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({
  e,
  onStatus,
  busy,
}: {
  e: FeedbackEntry;
  onStatus: (next: FeedbackStatus) => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5">
        <span title={e.sentiment}>{FACE[e.sentiment]}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {KIND_ICON[e.kind]} {e.kind}
        </span>
        {e.screenshot && <span title="Has screenshot">📷</span>}
        {e.voiceNote && <span title="Has voice note">🎤</span>}
        {e.target && (
          <span className="text-primary" title={e.target.selector}>
            🎯
          </span>
        )}
      </div>
      <Link
        href={`/feedback/${encodeURIComponent(e.id)}`}
        className="mt-1.5 block text-sm hover:text-primary"
      >
        {e.comment ? (
          <span className="line-clamp-3">{e.comment}</span>
        ) : (
          <span className="italic text-muted-foreground">(no comment)</span>
        )}
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2">
        <StatusControl value={e.status} onChange={onStatus} busy={busy} />
        <Link
          href={`/feedback/${encodeURIComponent(e.id)}`}
          className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary"
        >
          open →
        </Link>
      </div>
    </div>
  );
}
