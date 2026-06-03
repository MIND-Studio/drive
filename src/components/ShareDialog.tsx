"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@mind-studio/ui";
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

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg" data-testid="share-dialog">
        <DialogHeader>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Share
          </p>
          <DialogTitle className="truncate">{resourceName}</DialogTitle>
          <DialogDescription>
            Grant read access by WebID, or publish a public read-only link.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="webid" data-testid="share-tab-webid">
              With WebID
            </TabsTrigger>
            <TabsTrigger value="public" data-testid="share-tab-public">
              Public link
            </TabsTrigger>
          </TabsList>

          <div className="mt-4 min-h-[180px]">
            <TabsContent value="webid">
              <form onSubmit={onGrantWebId} className="space-y-3">
                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Recipient WebID
                  </Label>
                  <Input
                    type="url"
                    value={webId}
                    onChange={(e) => setWebId(e.target.value)}
                    placeholder="http://localhost:3061/bob/profile/card#me"
                    data-testid="share-webid-input"
                  />
                </div>
                <Button type="submit" disabled={busy} data-testid="share-webid-grant">
                  Grant read
                </Button>
                {grantedWebIds.length > 0 ? (
                  <ul className="mt-3 space-y-1.5">
                    {grantedWebIds.map((w) => (
                      <li
                        key={w}
                        className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs"
                      >
                        <span className="truncate font-mono">{w}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => onRevokeWebId(w)}
                          disabled={busy}
                          className="text-destructive hover:text-destructive"
                        >
                          Revoke
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </form>
            </TabsContent>

            <TabsContent value="public">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm">
                      Make this file readable by anyone with the link.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Current state: {publicRead ? "public" : "private"}
                    </p>
                  </div>
                  <Button
                    onClick={() => onTogglePublic(!publicRead)}
                    disabled={busy}
                    variant={publicRead ? "outline" : "default"}
                    className={
                      publicRead
                        ? "border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        : undefined
                    }
                    data-testid="share-public-toggle"
                  >
                    {publicRead ? "Revoke" : "Make public"}
                  </Button>
                </div>
                {publicRead ? (
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                      Shareable URL
                    </p>
                    <p
                      className="mt-2 break-all font-mono text-xs"
                      data-testid="share-public-url"
                    >
                      {resourceUrl}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onCopyLink}
                      className="mt-2"
                      data-testid="share-public-copy"
                    >
                      {copyMsg ?? "Copy"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </TabsContent>
          </div>
        </Tabs>

        {confirmation ? (
          <p
            className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-primary"
            data-testid="share-confirmation"
          >
            {confirmation}
          </p>
        ) : null}
        {error ? (
          <p
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            data-testid="share-error"
          >
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
