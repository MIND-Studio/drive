"use client";

import { useState } from "react";

export default function PassphraseDialog({
  title,
  prompt,
  confirmRequired,
  onSubmit,
  onCancel,
  error,
}: {
  title: string;
  prompt: string;
  /** True for set-passphrase flow (requires double-entry to confirm). */
  confirmRequired: boolean;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
  error?: string | null;
}) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [mismatch, setMismatch] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (confirmRequired && p1 !== p2) {
      setMismatch(true);
      return;
    }
    if (!p1) return;
    onSubmit(p1);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      data-testid="passphrase-dialog"
    >
      <div className="w-full max-w-md rounded-lg border border-[color:var(--ink-trace)] bg-[color:var(--paper)] p-6 shadow-xl">
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Encryption
        </p>
        <h2
          className="display mt-1 text-xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        <p className="mt-3 text-sm text-[color:var(--ink-soft)]">{prompt}</p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <input
            type="password"
            autoFocus
            value={p1}
            onChange={(e) => {
              setP1(e.target.value);
              setMismatch(false);
            }}
            placeholder="Passphrase"
            className="w-full rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 text-sm focus:border-[color:var(--accent)] focus:outline-none"
            data-testid="passphrase-input"
          />
          {confirmRequired ? (
            <input
              type="password"
              value={p2}
              onChange={(e) => {
                setP2(e.target.value);
                setMismatch(false);
              }}
              placeholder="Confirm passphrase"
              className="w-full rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 text-sm focus:border-[color:var(--accent)] focus:outline-none"
              data-testid="passphrase-confirm"
            />
          ) : null}
          {mismatch ? (
            <p className="text-xs text-[color:var(--status-bad)]">
              Passphrases do not match.
            </p>
          ) : null}
          {error ? (
            <p
              className="rounded-md border border-[color:var(--status-bad)] bg-[color:var(--status-bad-soft)] px-3 py-2 text-xs text-[color:var(--status-bad)]"
              data-testid="passphrase-error"
            >
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-[color:var(--ink-trace)] px-3 py-1.5 text-sm hover:border-[color:var(--accent)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-[color:var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[color:var(--accent-deep)]"
              data-testid="passphrase-submit"
            >
              Continue
            </button>
          </div>
        </form>
        {confirmRequired ? (
          <p className="mt-4 rounded-md border border-[color:var(--status-warn)] bg-[color:var(--paper-soft)] p-3 text-xs text-[color:var(--ink-soft)]">
            <strong>Heads up:</strong> there is no recovery. If you lose this
            passphrase, the encrypted files are unrecoverable.
          </p>
        ) : null}
      </div>
    </div>
  );
}
