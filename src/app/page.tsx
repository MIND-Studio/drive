import Link from "next/link";

export default function Landing() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-16 sm:px-10">
      <p
        className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        Privacy-first file storage on Solid Pods
      </p>
      <h1
        className="display mt-4 text-5xl leading-tight sm:text-6xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Your <em>files</em>, in your <em>pod</em>.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--ink-soft)]">
        Mind Drive is a Google Drive / Dropbox alternative where every byte
        lives in your Solid Pod — your own storage, on your own terms. No
        central server ever sees your files.
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/connect"
          className="rounded-md bg-[color:var(--accent)] px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-[color:var(--accent-deep)]"
        >
          Connect a pod
        </Link>
        <Link
          href="/drive"
          className="rounded-md border border-[color:var(--ink-trace)] px-5 py-3 text-sm text-[color:var(--ink)] hover:border-[color:var(--accent)]"
        >
          Open My Drive
        </Link>
      </div>

      <section className="mt-20 grid gap-8 sm:grid-cols-3">
        <Feature
          title="No central server"
          body="Your browser talks directly to your pod. Nothing in between sees your bytes."
        />
        <Feature
          title="No vendor lock-in"
          body="Files are plain bytes in your pod. Walk away tomorrow and take everything."
        />
        <Feature
          title="Solid-native"
          body="Built on LDP + WAC. Any other Solid app can keep operating on the same data."
        />
      </section>
    </section>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p
        className="display text-lg"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[color:var(--ink-soft)]">
        {body}
      </p>
    </div>
  );
}
