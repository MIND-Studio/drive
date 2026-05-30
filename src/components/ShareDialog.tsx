"use client";

import { useEffect, useState } from "react";
import {
  getAgentAccess,
  setAgentRead,
  getPublicAccess,
  setPublicRead,
} from "@/lib/solid/access";

type Tab = "webid" | "public";

export default function ShareDialog({
  resourceUrl,
  resourceName,
  onClose,
}: {
  resourceUrl: string;
  resourceName: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("webid");
  const [webId, setWebId] = useState("");
  const [grantedWebIds, setGrantedWebIds] = useState<string[]>([]);
  const [publicRead, setPublicReadState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  // Probe current public access on open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const flags = await getPublicAccess(resourceUrl);
      if (cancelled) return;
      setPublicReadState(Boolean(flags?.read));
    })();
    return () => {
      cancelled = true;
    };
  }, [resourceUrl]);

  async function onGrantWebId(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConfirmation(null);
    const trimmed = webId.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("WebID must be a full URL (e.g. http://localhost:3061/bob/profile/card#me).");
      return;
    }
    setBusy(true);
    try {
      await setAgentRead(resourceUrl, trimmed, true);
      const probe = await getAgentAccess(resourceUrl, trimmed);
      if (probe?.read) {
        setGrantedWebIds((prev) =>
          prev.includes(trimmed) ? prev : [...prev, trimmed]
        );
        setConfirmation(`Granted read to ${trimmed}`);
        setWebId("");
      } else {
        setError("Grant did not stick. CSS may be denying writes to .acl.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRevokeWebId(target: string) {
    setError(null);
    setConfirmation(null);
    setBusy(true);
    try {
      await setAgentRead(resourceUrl, target, false);
      setGrantedWebIds((prev) => prev.filter((w) => w !== target));
      setConfirmation(`Revoked ${target}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePublic(next: boolean) {
    setError(null);
    setConfirmation(null);
    setBusy(true);
    try {
      await setPublicRead(resourceUrl, next);
      const probe = await getPublicAccess(resourceUrl);
      setPublicReadState(Boolean(probe?.read));
      setConfirmation(next ? "Now publicly readable" : "Public access revoked");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(resourceUrl);
      setCopyMsg("Copied!");
      setTimeout(() => setCopyMsg(null), 2000);
    } catch (err) {
      setError(`Copy failed: ${String(err)}`);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="share-dialog"
    >
      <div className="w-full max-w-lg rounded-lg border border-[color:var(--ink-trace)] bg-[color:var(--paper)] p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p
              className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              Share
            </p>
            <h2
              className="display mt-1 truncate text-xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {resourceName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-[color:var(--ink-trace)] px-2 py-1 text-xs hover:border-[color:var(--accent)]"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          className="mt-5 inline-flex overflow-hidden rounded-md border border-[color:var(--ink-trace)]"
          role="tablist"
        >
          <button
            role="tab"
            aria-selected={tab === "webid"}
            onClick={() => setTab("webid")}
            className={`px-4 py-1.5 text-xs ${tab === "webid" ? "bg-[color:var(--accent)] text-white" : "hover:bg-[color:var(--paper-soft)]"}`}
            data-testid="share-tab-webid"
          >
            With WebID
          </button>
          <button
            role="tab"
            aria-selected={tab === "public"}
            onClick={() => setTab("public")}
            className={`px-4 py-1.5 text-xs ${tab === "public" ? "bg-[color:var(--accent)] text-white" : "hover:bg-[color:var(--paper-soft)]"}`}
            data-testid="share-tab-public"
          >
            Public link
          </button>
        </div>

        <div className="mt-4 min-h-[180px]">
          {tab === "webid" ? (
            <form onSubmit={onGrantWebId} className="space-y-3">
              <label className="block">
                <span
                  className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                >
                  Recipient WebID
                </span>
                <input
                  type="url"
                  value={webId}
                  onChange={(e) => setWebId(e.target.value)}
                  placeholder="http://localhost:3061/bob/profile/card#me"
                  className="mt-2 w-full rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 text-sm focus:border-[color:var(--accent)] focus:outline-none"
                  data-testid="share-webid-input"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[color:var(--accent-deep)] disabled:opacity-50"
                data-testid="share-webid-grant"
              >
                Grant read
              </button>
              {grantedWebIds.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {grantedWebIds.map((w) => (
                    <li
                      key={w}
                      className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-3 py-2 text-xs"
                    >
                      <span className="mono truncate">{w}</span>
                      <button
                        onClick={() => onRevokeWebId(w)}
                        disabled={busy}
                        className="rounded-md px-2 py-0.5 text-[color:var(--status-bad)] hover:bg-[color:var(--status-bad-soft)] disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm">
                    Make this file readable by anyone with the link.
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--ink-faint)]">
                    Current state: {publicRead ? "public" : "private"}
                  </p>
                </div>
                <button
                  onClick={() => onTogglePublic(!publicRead)}
                  disabled={busy}
                  className={`rounded-md px-4 py-2 text-sm font-medium ${publicRead ? "border border-[color:var(--status-bad)] text-[color:var(--status-bad)] hover:bg-[color:var(--status-bad-soft)]" : "bg-[color:var(--accent)] text-white hover:bg-[color:var(--accent-deep)]"} disabled:opacity-50`}
                  data-testid="share-public-toggle"
                >
                  {publicRead ? "Revoke" : "Make public"}
                </button>
              </div>
              {publicRead ? (
                <div className="rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] p-3">
                  <p
                    className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
                    style={{ fontFamily: "var(--font-mono-src)" }}
                  >
                    Shareable URL
                  </p>
                  <p
                    className="mono mt-2 break-all text-xs"
                    data-testid="share-public-url"
                  >
                    {resourceUrl}
                  </p>
                  <button
                    onClick={onCopyLink}
                    className="mt-2 rounded-md border border-[color:var(--ink-trace)] px-3 py-1 text-xs hover:border-[color:var(--accent)]"
                    data-testid="share-public-copy"
                  >
                    {copyMsg ?? "Copy"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {confirmation ? (
          <p
            className="mt-4 rounded-md border border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-3 py-2 text-xs text-[color:var(--accent-deep)]"
            data-testid="share-confirmation"
          >
            {confirmation}
          </p>
        ) : null}
        {error ? (
          <p
            className="mt-4 rounded-md border border-[color:var(--status-bad)] bg-[color:var(--status-bad-soft)] px-3 py-2 text-xs text-[color:var(--status-bad)]"
            data-testid="share-error"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
