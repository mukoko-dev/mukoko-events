# AGENTS.md

Standing rules for any coding agent working in this repo — the tool-agnostic
subset so every runner gets the same contract.

> **Claude Code users:** [`CLAUDE.md`](./CLAUDE.md) is the fuller guide (full
> architecture, data model, file map). This file is the tool-agnostic subset —
> where the two overlap they agree; when you need depth, read `CLAUDE.md`.

## What Mukoko Events is

A single full-stack **Next.js 16** app (App Router, React 19, TypeScript strict,
Tailwind v4) — the community events platform of the **Mukoko** ecosystem. There
is no separate application backend: data lives in **MongoDB** and is
read/written **server-side only** via the `mongodb` driver. Auth is **WorkOS
AuthKit**. Deployed on **Vercel** (auto-deploys every push). The Mukoko Events
MCP server and the Mukoko Events Admin app live in their own repos
(`nyuchi/mukoko-events-mcp`, `nyuchi/mukoko-events-admin`), not this one.

## Checks — must pass before you call a change done

Run all of these from the repo root; do not merge on a red check.

```bash
npm install
npm run lint       # ESLint + (in CI) markdownlint / prettier / etc.
npm run build      # Next.js production build
npm run test:run   # Vitest, run once (~682 tests)
```

- The **design-token guard** (`src/__tests__/design-tokens.test.ts`) is part of
  `test:run` — it enforces the mzizi doctrine tokens. If you touch
  `src/app/globals.css` or theme tokens, keep it green.
- Build **without** `MONGODB_URI` set (a reachable Mongo holding a published
  upcoming event breaks prerendering `/` — a known issue). For a DB-seeded
  build/verify, see the `release-check` and `db-seed-verify` skills.

## Boundaries — do not cross

- **Server-only Mongo.** MongoDB access is guarded by `import "server-only"`
  (`src/lib/mongo/`). Never touch the driver from a client component; the
  browser never connects to Mongo. Reads happen in Server Components, writes in
  Server Actions (`src/app/actions/`).
- **v3.1 document conventions.** Documents follow Mukoko v3.1: string-UUID
  `_id`, `_schemaVersion`, camelCase fields, BSON dates. Collections and
  validators are owned by the Mukoko platform, **not this repo** — there are no
  migrations here. If a change needs a data-model modification, coordinate it in
  the platform project first.
- **Cross-product write-through never throws.** The RSVP → Planner and
  event-update → Campfire mirrors (`src/lib/mongo/planner.ts`,
  `src/lib/mongo/campfire.ts`) run **after** the primary write succeeds and must
  **never throw** — failures are logged (`[mukoko]`) and swallowed, the same
  contract as `src/lib/email/resend.ts`. Preserve that.
- **`--primary` stays tanzanite.** In every theme, `--primary` is tanzanite.
  Cobalt is the "exceptional" mineral for links/info only
  (`--nh-secondary` / `--info`). Do **not** switch `--primary` to cobalt.
- **Never commit a model identifier.** Do not paste an AI model name or ID into
  code, commits, or docs.

## Conventions

- **Brand:** **"Mukoko Events"** in user-facing copy and docs. "Nhimbe" was retired as a brand on 2026-10-04 (mukoko-dev/nhimbe#155); keep _nhimbe_ only where it names the Shona practice, and leave state-bearing identifiers (`nhimbe-theme` and other storage keys, `.nh-*` classes, iCalendar UIDs) as they are.
- **TypeScript strict mode.** WCAG AAA (7:1+ contrast, comfortable touch
  targets). Dark/light via design tokens in `globals.css`.
- **React Context** for global state (AuthProvider, ThemeProvider) — no
  Redux/Zustand. `"use client"` only where interactivity requires it.
- **Structured logging:** prefix log output with `[mukoko]`.
- **Schema.org alignment** for events and people. Path alias `@/*` → `./src/*`.
- **No hardcoded content:** categories, cities, and stats come from data.

## Workflow

- **Target `staging`.** Branch off `staging` as `claude/<topic>-<slug>` (or
  `feat/…`, `fix/…`, `docs/…`) and open every PR into `staging`. Each merge
  into `staging` is tagged as the next patch. `staging` reaches `main`
  (production) only through the release PR, and a production hotfix goes the
  same way. **Never delete `staging`.**
- **Big PR, focused commits** — the Nyuchi house style. Related work lands in
  **one** pull request as a sequence of independently readable commits. Don't
  open a second PR for "just one more cleanup" — append a commit to the active
  branch.
- Open the PR as a **draft** against `staging`, mirror
  [`.github/pull_request_template.md`](./.github/pull_request_template.md), and
  **assign `bryanfawcett`**.
- CI must be green (lint + build + tests + CodeQL) and the Vercel preview Ready
  before review.

## Task routines (Skills)

Reusable routines live in [`.claude/skills/`](./.claude/skills/) as
`<name>/SKILL.md` — practical, not aspirational:

- `release-check` — the pre-merge gate (lint + build + test:run + design-token
  test, and how to run a DB-seeded build).
- `db-seed-verify` — the `mongodb-memory-server-core` seed-and-drive pattern for
  runtime verification without the Mukoko cluster.
- `verify` — runtime-verify a change in a sandbox (launch recipe, in-memory
  Mongo, dev auth bypass, gotchas).

## Track big work in GitHub issues

Any substantial build, migration, investigation or multi-step task gets a GitHub issue in the repo that owns it — before or as work starts — so another session, agent or person can pick it up.

- The issue holds the goal, the owner's decisions (verbatim where given), the plan, acceptance criteria, owner-only steps and links.
- Every PR references its issue (`Refs #n`; `Fixes #n` only when the merge completes it).
- Post progress, decisions and a hand-off note (what's done, what's left, branch names) as issue comments — at each merge and before a session or agent finishes.
- Work spanning repos gets a tracking issue that links the per-repo issues.
- Never put secrets, credential status or exploitable detail in issues on public repos.

## Dev skills, progress reports and the merge gate

Load the Mzizi **dev skills** before starting work: `mzizi_get_skills category=dev` on the Mzizi MCP (`mcp.mzizi.dev`), or `@nyuchi/mzizi-skills` from npm. They are `digital-hygiene` and `progress-report`.

- **Digital hygiene.** Check free disk before starting, clone only under `$TMPDIR`, share build caches, and audit, then delete, your clones once the work merges (`digital-hygiene` skill).
- **Clone isolation.** Clone only into a directory unique to you; never touch another agent's.
- **Progress reports.** All dev work runs on a 10-minute progress-report loop (`progress-report` skill): measured bars, what changed, and a final "Needs you:" line. Report ticks never publish, release, merge or deploy without the owner's approval.
- **Merge gate.** Merge only when the work is complete, CI is green, it's verified at runtime, and `/code-review` has run with findings resolved.
