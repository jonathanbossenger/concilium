import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-start justify-center gap-8 px-6 py-24">
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm font-medium uppercase tracking-widest">
          Agent Dashboard
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Monitor and operate your agents.
        </h1>
        <p className="text-muted-foreground max-w-xl text-pretty text-lg">
          The skeleton is live. Auth, the database, and the real product surfaces land in the
          sibling issues on the launch goal.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/dashboard">Open the dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="https://github.com/jonathanbossenger/agent-dashboard">View the repo</Link>
        </Button>
      </div>
    </main>
  );
}
