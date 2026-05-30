import type { Metadata } from "next";
import Link from "next/link";
import { DM_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import ThemeToggle from "@/components/ThemeToggle";
import { LauncherButton } from "@/components/LauncherButton";

// Sync IIFE that runs in <head> before paint, so we never flash the wrong
// theme. Defaults to dark (mind-drive's chosen identity); honors a stored
// `mind-drive:theme` override if the user has flipped to light. Wrapped in
// try/catch because storage throws in some private-browsing modes.
const THEME_INIT_SCRIPT = `(function(){try{var k='mind-drive:theme';var v=localStorage.getItem(k);if(v!=='light'&&v!=='dark')v='dark';document.documentElement.dataset.theme=v;document.documentElement.classList.toggle('dark',v==='dark');}catch(e){document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark');}})();`;

const fontDisplay = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  style: ["normal", "italic"],
});

const fontBody = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const fontMono = JetBrains_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Mind Drive — your files in your pod",
  description:
    "A privacy-first Google Drive / Dropbox alternative built on Solid Pods. Your bytes never leave your pod.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fontBody.variable} ${fontDisplay.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen flex flex-col">
        <Masthead />
        <main className="flex-1">{children}</main>
        <Colophon />
      </body>
    </html>
  );
}

function Masthead() {
  return (
    <header className="border-b border-[color:var(--ink-trace)] bg-[color:var(--paper)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-5 sm:px-10">
        <Link href="/" className="flex items-baseline gap-3">
          <span
            className="display text-2xl tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Mind <em>Drive</em>
          </span>
          <span className="hidden text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)] sm:inline">
            <span className="text-[color:var(--accent)]">●</span> files in your pod
          </span>
        </Link>
        <nav
          className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em]"
          aria-label="Main"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <Link
            href="/drive"
            className="px-2 py-1 text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
          >
            My drive
          </Link>
          <Link
            href="/connect"
            className="px-2 py-1 text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
          >
            Connect pod
          </Link>
          <LauncherButton />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

function Colophon() {
  return (
    <footer className="mt-16 border-t border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)]">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <p
          className="display text-2xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Mind <em>Drive</em>
        </p>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-[color:var(--ink-soft)]">
          A prototype that treats your Solid Pod as a real Drive. No central
          server holds your bytes. Sibling of Mind Market, Codespaces, OS, and
          Social Network.
        </p>
        <p
          className="mt-6 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          v0.1 · walking skeleton
        </p>
      </div>
    </footer>
  );
}
