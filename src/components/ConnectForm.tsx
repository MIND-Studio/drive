"use client";

import { useEffect, useState } from "react";
import { login } from "@inrupt/solid-client-authn-browser";
import {
  MindLoginCard,
  browserOidcLogin,
  writeLastIdentity,
  clearLastIdentity,
} from "@mind-studio/core";
import { DEFAULT_ISSUER, session, rememberIssuer } from "@/lib/solid/session";
import { ensureSession, rememberReturnTo } from "@/lib/solid/auth";

const APP_NAME = "Drive";

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
      <div className="rounded-md border border-[color:var(--accent)] bg-[color:var(--accent-soft)] p-5">
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--accent-deep)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Connected
        </p>
        <p className="mt-2 mono text-sm break-all" data-testid="webid">
          {webId}
        </p>
        <div className="mt-4 flex gap-3">
          <a
            href="/drive"
            className="rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm text-white hover:bg-[color:var(--accent-deep)]"
          >
            Open My Drive →
          </a>
          <button
            onClick={onLogout}
            className="rounded-md border border-[color:var(--ink-trace)] px-4 py-2 text-sm hover:border-[color:var(--accent)]"
          >
            Disconnect
          </button>
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
        accent="#2f5fa6"
        onLogin={async ({ issuer }) => {
          rememberIssuer(issuer);
          rememberReturnTo("/drive");
          await handleLogin({ issuer });
        }}
      />
      {error && (
        <p className="mt-4 rounded-md border border-[color:var(--status-bad)] bg-[color:var(--status-bad-soft)] px-3 py-2 text-sm text-[color:var(--status-bad)]">
          {error}
        </p>
      )}
    </>
  );
}
