"use client";

import { login } from "@inrupt/solid-client-authn-browser";
import { clearLastIdentity, MindLoginCard, writeLastIdentity } from "@mind-studio/core";
import { Button } from "@mind-studio/ui";
import { useEffect, useState } from "react";
import { ensureSession, rememberReturnToDefault, shouldAutoLoginEmbedded } from "@/lib/solid/auth";
import { DEFAULT_ISSUER, rememberIssuer, session } from "@/lib/solid/session";

const APP_NAME = "Drive";
const CLIENT_NAME = "Mind Drive";

/**
 * Start the OIDC redirect. Mirrors `@mind-studio/core`'s `browserOidcLogin` but
 * adds a stable Solid-OIDC `clientId` (our `/api/client-id` document) so the
 * IdP recognises the same client across sessions and stops re-prompting for
 * consent on every load (the dynamic-registration churn — see the route file).
 *
 * Gated to non-localhost origins: a containerised dev IdP (CSS in Docker) can't
 * dereference a `http://localhost:3060/...` client id document, so dev keeps the
 * dynamic-registration path. Production (drive.mindpods.org) is publicly
 * reachable by the pod, so it uses the durable client identity.
 */
function startLogin({ issuer }: { issuer: string }) {
  const origin = window.location.origin;
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  return login({
    oidcIssuer: issuer,
    redirectUrl: new URL("/login/callback", origin).toString(),
    clientName: CLIENT_NAME,
    ...(isLocal ? {} : { clientId: new URL("/api/client-id", origin).toString() }),
  });
}

export default function ConnectForm() {
  const [webId, setWebId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoConnecting, setAutoConnecting] = useState(false);

  useEffect(() => {
    ensureSession()
      .then((info) => {
        const id = info.webId ?? null;
        setWebId(id);
        if (id) {
          writeLastIdentity(APP_NAME, {
            webId: id,
            displayName: id.split("/").filter(Boolean).pop(),
          });
          return;
        }
        // Hosted in the Mind shell + signed out → start SSO in the background
        // (one-shot, guarded) so the user never has to click "connect" here.
        if (shouldAutoLoginEmbedded()) {
          setAutoConnecting(true);
          rememberIssuer(DEFAULT_ISSUER);
          rememberReturnToDefault("/drive");
          void startLogin({ issuer: DEFAULT_ISSUER });
        }
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onLogout() {
    await session().logout();
    clearLastIdentity(APP_NAME);
    setWebId(null);
  }

  if (webId) {
    return (
      <div className="rounded-lg border border-primary/40 bg-primary/5 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">Connected</p>
        <p className="mt-2 break-all font-mono text-sm" data-testid="webid">
          {webId}
        </p>
        <div className="mt-4 flex gap-3">
          <Button asChild>
            <a href="/drive">Open My Drive →</a>
          </Button>
          <Button variant="outline" onClick={onLogout}>
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  // While the embedded silent redirect is in flight, show a quiet "connecting"
  // panel instead of the login card — the user shouldn't see a sign-in prompt
  // flash before the SSO round-trip completes.
  if (autoConnecting && !error) {
    return (
      <div className="rounded-lg border border-primary/40 bg-primary/5 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
          Connecting…
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Signing you in to your pod.</p>
      </div>
    );
  }

  return (
    <>
      <MindLoginCard
        appName={APP_NAME}
        defaultIssuer={DEFAULT_ISSUER}
        onLogin={async ({ issuer }) => {
          rememberIssuer(issuer);
          // Fall back to /drive only if a deep link wasn't already remembered
          // by the signed-out screen the user came from.
          rememberReturnToDefault("/drive");
          await startLogin({ issuer });
        }}
      />
      {error && (
        <p className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
