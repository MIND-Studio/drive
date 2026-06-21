import { Button, ThemeProvider, Toaster } from "@mind-studio/ui";
import { mind } from "@mind-studio/ui/themes";
import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { BrokerThemeSync } from "@/components/BrokerThemeSync";
import { FeedbackLauncher } from "@/components/FeedbackLauncher";
import { LauncherButton } from "@/components/LauncherButton";
import { StandaloneOnly } from "@/components/StandaloneOnly";
import ThemeToggle from "@/components/ThemeToggle";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});
const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jb",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mind Drive — your files in your pod",
  description:
    "A privacy-first Google Drive / Dropbox alternative built on Solid Pods. Your bytes never leave your pod.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-mind-theme="mind"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen flex flex-col bg-background text-foreground">
        <ThemeProvider
          theme={mind}
          defaultTheme="dark"
          enableSystem={false}
          storageKey="mind-drive-theme"
        >
          <BrokerThemeSync />
          <StandaloneOnly>
            <Masthead />
          </StandaloneOnly>
          <main className="flex-1">{children}</main>
          <StandaloneOnly>
            <Colophon />
            <FeedbackLauncher />
          </StandaloneOnly>
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}

function Masthead() {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4 sm:px-10">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold tracking-tight">Mind Drive</span>
          <span className="hidden text-[10px] uppercase tracking-[0.22em] text-muted-foreground sm:inline">
            <span className="text-primary">●</span> files in your pod
          </span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Main">
          <Button asChild variant="ghost" size="sm">
            <Link href="/drive">My drive</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/connect">Connect pod</Link>
          </Button>
          <LauncherButton />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

function Colophon() {
  return (
    <footer className="mt-16 border-t bg-muted/40">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
        <p className="text-2xl font-semibold tracking-tight">Mind Drive</p>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          A prototype that treats your Solid Pod as a real Drive. No central server holds your
          bytes. Sibling of Mind Market, Codespaces, OS, and Social Network.
        </p>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          v0.1 · walking skeleton
        </p>
      </div>
    </footer>
  );
}
