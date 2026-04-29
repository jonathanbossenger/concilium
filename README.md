# Agent Dashboard

The web app for monitoring and operating Paperclip-style agents. Working name `paperclipai/agent-dashboard` — final GitHub home is being confirmed by the board.

## Stack

- **Framework**: Next.js (App Router) + React 19 + TypeScript (strict)
- **Styling**: Tailwind CSS v4 + [shadcn/ui](https://ui.shadcn.com/) primitives
- **Tooling**: ESLint (flat config) + Prettier
- **Package manager**: pnpm (workspace at the repo root)

Database (Postgres + Prisma), auth (Clerk), CI (GitHub Actions), and deploys (Vercel) land in sibling issues — see the launch goal "Preparing the Agent Dashboard for public launch" for the roadmap.

## Layout

```
/                    pnpm workspace root
├── apps/
│   └── web/         Next.js application (the dashboard)
└── packages/        shared packages — none yet
```

## Local development

Requires Node 20.11+ and pnpm 9+.

```bash
pnpm install
pnpm dev          # boots apps/web on http://localhost:3000
```

Useful routes during the skeleton phase:

- `/` — public landing placeholder
- `/dashboard` — signed-in dashboard placeholder

## Quality gates

```bash
pnpm typecheck    # tsc --noEmit on apps/web
pnpm lint         # eslint on apps/web
pnpm format:check # prettier check across the workspace
pnpm build        # production build of apps/web
```

These same checks will run in CI once the GitHub Actions pipeline lands.
