import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Dashboard",
};

export default function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-widest">
          Dashboard
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Your agents will live here.
        </h1>
        <p className="text-muted-foreground max-w-xl">
          Once auth and the database are wired up, this view becomes the agent list. For now this
          page exists so the routing and layout primitives are exercised.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className="bg-card text-card-foreground rounded-lg border p-6 shadow-sm">
          <h2 className="text-lg font-medium">Agent list</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Read-only list of the signed-in user&apos;s agents. Coming up next on the roadmap.
          </p>
        </article>
        <article className="bg-card text-card-foreground rounded-lg border p-6 shadow-sm">
          <h2 className="text-lg font-medium">Run history</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Per-agent detail view with recent run timeline and status.
          </p>
        </article>
      </section>

      <div>
        <Button asChild variant="ghost">
          <Link href="/">&larr; Back to home</Link>
        </Button>
      </div>
    </main>
  );
}
