"use client";

import { useEffect, useState } from "react";
import { login } from "@inrupt/solid-client-authn-browser";
import {
  MindLoginCard,
  browserOidcLogin,
  writeLastIdentity,
  clearLastIdentity,
} from "@mind-studio/core";
import { Button } from "@mind-studio/ui";
import { DEFAULT_ISSUER, session, rememberIssuer } from "@/lib/solid/session";
import { ensureSession, rememberReturnToDefault } from "@/lib/solid/auth";

const APP_NAME = "Drive";
// Mind brand primary (teal), so the login card matches the design system.
const MIND_ACCENT = "#0d9488";

export default function ConnectForm() {
  const [webId, setWebId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  async function onLogout() {
    await session().logout();
    clearLastIdentity(APP_NAME);
    setWebId(null);
  }

  if (webId) {
    return (
      <div className="rounded-lg border border-primary/40 bg-primary/5 p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
          Connected
        </p>
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

  const handleLogin = browserOidcLogin(login, {
    callbackPath: "/login/callback",
    clientName: "Mind Drive",
  });

  return (
    <>
      <MindLoginCard
        appName={APP_NAME}
        defaultIssuer={DEFAULT_ISSUER}
        accent={MIND_ACCENT}
        onLogin={async ({ issuer }) => {
          rememberIssuer(issuer);
          // Fall back to /drive only if a deep link wasn't already remembered
          // by the signed-out screen the user came from.
          rememberReturnToDefault("/drive");
          await handleLogin({ issuer });
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
