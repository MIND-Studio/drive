"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@mind-studio/ui";
import { completeLoginRedirect, consumeReturnTo } from "@/lib/solid/auth";

export default function LoginCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Consume the OIDC code, then SPA-navigate to the returnTo. We use
    // `router.replace` (not `window.location.replace`) so the in-memory
    // @inrupt session survives — a hard navigation would wipe it and the
    // destination page would render as signed-out.
    //
    // `completeLoginRedirect` shares one single-flight `handleIncomingRedirect`
    // with `ensureSession`, so the layout's launcher (mounted here too) can't
    // redeem the one-time code a second time and reset the session.
    completeLoginRedirect()
      .then((info) => {
        if (!info.isLoggedIn) {
          setError("Sign-in did not complete. Please try again.");
          return;
        }
        const returnTo = consumeReturnTo();
        router.replace(returnTo);
      })
      .catch((e) => setError(String(e)));
  }, [router]);

  return (
    <section className="mx-auto max-w-md px-6 py-20 text-center">
      {error ? (
        <>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-destructive">
            Login failed
          </p>
          <p className="mt-3 break-all font-mono text-sm">{error}</p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/connect">Try again</Link>
          </Button>
        </>
      ) : (
        <p className="text-muted-foreground">Finishing sign-in…</p>
      )}
    </section>
  );
}
