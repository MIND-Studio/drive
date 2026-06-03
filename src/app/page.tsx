import Link from "next/link";
import { Button } from "@mind-studio/ui";

export default function Landing() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-16 sm:px-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Privacy-first file storage on Solid Pods
      </p>
      <h1 className="mt-4 text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
        Your files, in your pod.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
        Mind Drive is a Google Drive / Dropbox alternative where every byte
        lives in your Solid Pod — your own storage, on your own terms. No
        central server ever sees your files.
      </p>
      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/connect">Connect a pod</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/drive">Open My Drive</Link>
        </Button>
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
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
