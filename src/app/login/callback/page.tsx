"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { handleIncomingRedirect } from "@inrupt/solid-client-authn-browser";
import { consumeReturnTo } from "@/lib/solid/auth";

export default function LoginCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Consume the OIDC code, then SPA-navigate to the returnTo. We use
    // `router.replace` (not `window.location.replace`) so the in-memory
    // @inrupt session survives — a hard navigation would wipe it and the
    // destination page would render as signed-out.
    handleIncomingRedirect({ url: window.location.href })
      .then(() => {
        const returnTo = consumeReturnTo();
        router.replace(returnTo);
      })
      .catch((e) => setError(String(e)));
  }, [router]);

  return (
    <section className="mx-auto max-w-md px-6 py-20 text-center">
      {error ? (
        <>
          <p
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--status-bad)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Login failed
          </p>
          <p className="mono mt-3 break-all text-sm">{error}</p>
          <a
            href="/connect"
            className="mt-6 inline-block rounded-md border border-[color:var(--ink-trace)] px-4 py-2 text-sm hover:border-[color:var(--accent)]"
          >
            Try again
          </a>
        </>
      ) : (
        <p className="text-[color:var(--ink-faint)]">Finishing sign-in…</p>
      )}
    </section>
  );
}
