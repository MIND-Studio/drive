"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@mind-studio/ui";
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="passphrase-dialog">
        <DialogHeader>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Encryption
          </p>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{prompt}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            type="password"
            autoFocus
            value={p1}
            onChange={(e) => {
              setP1(e.target.value);
              setMismatch(false);
            }}
            placeholder="Passphrase"
            data-testid="passphrase-input"
          />
          {confirmRequired ? (
            <Input
              type="password"
              value={p2}
              onChange={(e) => {
                setP2(e.target.value);
                setMismatch(false);
              }}
              placeholder="Confirm passphrase"
              data-testid="passphrase-confirm"
            />
          ) : null}
          {mismatch ? <p className="text-xs text-destructive">Passphrases do not match.</p> : null}
          {error ? (
            <p
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              data-testid="passphrase-error"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" data-testid="passphrase-submit">
              Continue
            </Button>
          </DialogFooter>
        </form>
        {confirmRequired ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">Heads up:</strong> there is no recovery. If you lose
            this passphrase, the encrypted files are unrecoverable.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
