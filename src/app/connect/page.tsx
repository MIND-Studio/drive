import ConnectForm from "@/components/ConnectForm";

// The dev-shortcut panel describes the LOCAL CSS instance's seeded accounts.
// Only show it when this build targets a local issuer — otherwise it leaks
// dev credentials onto the production pod (pods.mindpods.org). Mirrors the
// DEFAULT_ISSUER resolution in src/lib/solid/session.ts (build-time inlined).
const ISSUER =
  process.env.NEXT_PUBLIC_SOLID_ISSUER ??
  process.env.NEXT_PUBLIC_POD_BASE_URL ??
  "https://pods.mindpods.org/";
const IS_LOCAL_ISSUER =
  ISSUER.includes("localhost") || ISSUER.includes("127.0.0.1");
// Show the actual issuer host the build targets, not a hardcoded port — the
// dev CSS lives on different ports across the fleet (3011 shared / 3061 drive's
// own / 3101), and "Continue with Mind" redirects to *this* issuer, so the
// shortcut must name the same place or it sends devs to a server with no
// matching account.
const ISSUER_HOST = (() => {
  try {
    return new URL(ISSUER).host;
  } catch {
    return ISSUER;
  }
})();

export default function ConnectPage() {
  return (
    <section className="mx-auto max-w-2xl px-6 py-16 sm:px-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Step 1 — connect a pod
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">
        Sign in with your Solid identity.
      </h1>
      <p className="mt-4 text-muted-foreground">
        Pick the issuer that hosts your pod. We&apos;ll redirect you there for
        the OIDC dance and come back here once you&apos;re signed in.
      </p>
      <div className="mt-8">
        <ConnectForm />
      </div>
      {IS_LOCAL_ISSUER && (
        <div className="mt-12 rounded-lg border bg-muted/40 px-5 py-4 text-sm text-muted-foreground">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Dev shortcut
          </p>
          <p className="mt-2">
            The local CSS instance at{" "}
            <span className="font-mono text-foreground">{ISSUER_HOST}</span> has
            two pre-seeded accounts (run <span className="font-mono">npm run
            seed:demo</span> against this issuer if sign-in fails):
          </p>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            <li>alice@mind-drive.local · dev-only-do-not-use-in-prod</li>
            <li>bob@mind-drive.local · dev-only-do-not-use-in-prod</li>
          </ul>
        </div>
      )}
    </section>
  );
}
