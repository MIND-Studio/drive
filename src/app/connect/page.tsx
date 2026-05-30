import ConnectForm from "@/components/ConnectForm";

export default function ConnectPage() {
  return (
    <section className="mx-auto max-w-2xl px-6 py-16 sm:px-10">
      <p
        className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        Step 1 — connect a pod
      </p>
      <h1
        className="display mt-4 text-4xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Sign in with your <em>Solid</em> identity.
      </h1>
      <p className="mt-4 text-[color:var(--ink-soft)]">
        Pick the issuer that hosts your pod. We&apos;ll redirect you there for
        the OIDC dance and come back here once you&apos;re signed in.
      </p>
      <div className="mt-8">
        <ConnectForm />
      </div>
      <div className="mt-12 rounded-md border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-5 py-4 text-sm text-[color:var(--ink-soft)]">
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Dev shortcut
        </p>
        <p className="mt-2">
          The local CSS instance on port 3061 has two pre-seeded accounts:
        </p>
        <ul className="mt-2 space-y-1 mono text-xs">
          <li>alice@mind-drive.local · dev-only-do-not-use-in-prod</li>
          <li>bob@mind-drive.local · dev-only-do-not-use-in-prod</li>
        </ul>
      </div>
    </section>
  );
}
