"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@mind-studio/ui";
import { readFeedback, setFeedbackStatus } from "@mind-studio/core/feedback";
import type {
  FeedbackEntry,
  Sentiment,
  FeedbackKind,
  FeedbackStatus,
} from "@mind-studio/core/feedback";
import { feedbackInbox } from "@/lib/config";
import { ensureSession, rememberSignedOutPath } from "@/lib/solid/auth";
import { podFetch } from "@/lib/solid/pod-fs";
import { StatusControl } from "@/components/FeedbackBoard";

const FACE: Record<Sentiment, string> = { bad: "😞", meh: "😐", good: "🙂", love: "😍" };
const FACE_LABEL: Record<Sentiment, string> = {
  bad: "Bad",
  meh: "Meh",
  good: "Good",
  love: "Love it",
};
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

export default function FeedbackDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);

  const [ready, setReady] = useState(false);
  const [webId, setWebId] = useState<string | null>(null);
  const [entry, setEntry] = useState<FeedbackEntry | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"ok" | "denied" | "notfound">("ok");
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    ensureSession()
      .then((info) => setWebId(info.webId ?? null))
      .catch(() => setWebId(null))
      .finally(() => setReady(true));
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setState("ok");
    const fetcher = podFetch();
    try {
      const probe = await fetcher(feedbackInbox, { method: "GET" });
      if (probe.status === 401 || probe.status === 403) {
        setState("denied");
        setEntry(null);
        rememberSignedOutPath();
        return;
      }
      const list = await readFeedback(feedbackInbox, fetcher);
      const found = list.find((e) => e.id === id) ?? null;
      setEntry(found);
      if (!found) setState("notfound");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [id]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const updateStatus = useCallback(
    async (next: FeedbackStatus) => {
      if (!entry || entry.status === next) return;
      const prev = entry.status;
      setEntry({ ...entry, status: next });
      setStatusBusy(true);
      try {
        await setFeedbackStatus(entry.url, next, podFetch());
      } catch (err) {
        setEntry({ ...entry, status: prev });
        setError(`Couldn't update status: ${(err as Error).message}`);
      } finally {
        setStatusBusy(false);
      }
    },
    [entry],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
      <header className="mb-6">
        <Link
          href="/feedback"
          className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-primary"
        >
          ← back to inbox
        </Link>
        <h1 className="mt-2 truncate font-mono text-sm text-muted-foreground">{id}</h1>
      </header>

      {error && (
        <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-4 py-2 font-mono text-[11px] text-destructive">
          ⚠ {error}
        </div>
      )}

      {busy ? (
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          // reading record…
        </p>
      ) : state === "denied" && !webId ? (
        // Deep-linked while signed out (a hard load drops the in-memory
        // session by design — see auth.ts). Offer the way back in; /connect
        // returns to the remembered path with the session intact.
        <div className="rounded-xl border border-dashed px-6 py-12 text-center">
          <div className="text-3xl">🔑</div>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to read this feedback record.
          </p>
          <Button asChild className="mt-4">
            <Link href="/connect">Connect a pod</Link>
          </Button>
        </div>
      ) : state === "denied" ? (
        <Empty icon="🔒" text="You don't have read access to this inbox." />
      ) : state === "notfound" || !entry ? (
        <Empty icon="🕳" text="No feedback record with that id." />
      ) : (
        <article className="flex flex-col gap-5">
          {/* Headline */}
          <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
            <span className="text-3xl" title={entry.sentiment}>
              {FACE[entry.sentiment]}
            </span>
            <div>
              <div className="font-semibold">{FACE_LABEL[entry.sentiment]}</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {KIND_ICON[entry.kind]} {entry.kind}
                {entry.createdAt ? ` · ${new Date(entry.createdAt).toLocaleString()}` : ""}
              </div>
            </div>
            <div className="ml-auto">
              <StatusControl value={entry.status} onChange={updateStatus} busy={statusBusy} />
            </div>
          </div>

          {/* Comment */}
          <Section title="comment">
            {entry.comment ? (
              <p className="whitespace-pre-wrap text-sm">{entry.comment}</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">(no comment)</p>
            )}
          </Section>

          {/* Voice note */}
          {entry.voiceNote && (
            <Section title="voice note">
              <audio src={entry.voiceNote} controls className="w-full" />
            </Section>
          )}

          {/* Screenshot */}
          {entry.screenshot && (
            <Section title="screenshot">
              <a href={entry.screenshot} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.screenshot}
                  alt="Feedback screenshot"
                  className="max-h-96 w-full rounded-lg border object-contain"
                />
              </a>
            </Section>
          )}

          {/* Pointed element */}
          {entry.target && (
            <Section title="pointed element">
              <ElementDiagram entry={entry} />
            </Section>
          )}

          {/* Client errors */}
          {entry.clientErrors && (
            <Section title="client errors">
              <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-[10px] text-destructive">
                {entry.clientErrors}
              </pre>
            </Section>
          )}

          {/* Context */}
          <Section title="context">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
              <Row label="by" value={entry.webId ? shortName(entry.webId) : "anonymous"} />
              {entry.webId && <Row label="webid" value={entry.webId} breakAll />}
              {entry.route && <Row label="route" value={entry.route} />}
              {entry.viewport && <Row label="viewport" value={entry.viewport} />}
              {entry.appVersion && <Row label="version" value={entry.appVersion} />}
              {entry.userAgent && <Row label="agent" value={entry.userAgent} breakAll />}
              <Row label="app" value={entry.appKey} />
              <Row label="resource" value={entry.url} breakAll />
            </dl>
          </Section>
        </article>
      )}
    </main>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed px-6 py-12 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="mt-2 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  breakAll,
}: {
  label: string;
  value: string;
  breakAll?: boolean;
}) {
  return (
    <>
      <dt className="opacity-70">{label}</dt>
      <dd className={breakAll ? "break-all" : ""}>{value}</dd>
    </>
  );
}

/**
 * Show *where* the pointed element was: a viewport-proportioned frame (from the
 * record's `viewport`, falling back to the rect's own extent) with the captured
 * `rect` drawn inside. Plus the descriptor (label / selector / text / size).
 */
function ElementDiagram({ entry }: { entry: FeedbackEntry }) {
  const t = entry.target!;
  const [vw, vh] = (entry.viewport.match(/^(\d+)x(\d+)$/)?.slice(1).map(Number) ??
    [t.rect.x + t.rect.w, t.rect.y + t.rect.h]) as [number, number];
  const FRAME_W = 280;
  const scale = vw > 0 ? FRAME_W / vw : 1;
  const frameH = Math.max(40, Math.round(vh * scale));

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="text-sm">
        🎯 {t.label}
        {t.text ? <span className="text-muted-foreground"> · “{t.text}”</span> : null}
      </div>
      <div
        className="relative shrink-0 self-start overflow-hidden rounded-md border bg-muted/40"
        style={{ width: FRAME_W, height: frameH }}
        title={`viewport ${vw}×${vh}`}
      >
        <div
          className="absolute rounded-sm border-2 border-primary bg-primary/20"
          style={{
            left: Math.round(t.rect.x * scale),
            top: Math.round(t.rect.y * scale),
            width: Math.max(3, Math.round(t.rect.w * scale)),
            height: Math.max(3, Math.round(t.rect.h * scale)),
          }}
        />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <Row label="selector" value={t.selector} breakAll />
        <Row label="tag" value={t.tag + (t.role ? ` (role=${t.role})` : "")} />
        {t.testid && <Row label="testid" value={t.testid} />}
        <Row
          label="rect"
          value={`${t.rect.w}×${t.rect.h} @ ${t.rect.x},${t.rect.y}`}
        />
      </dl>
    </div>
  );
}
