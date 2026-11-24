# Signal

An AI lead-qualification and account-matching engine. Raw account signal goes
in; a prioritized, **explained** routing decision comes out.

Most tools in this space either score without reasoning (a black-box number a
rep won't trust), enrich without judgment (clean data, no decision), or route
without context (a static rule, not evidence). Signal closes that loop: every
routing decision ships with the reasoning that produced it.

> **Status: vertical slice complete, in active development.** The full pipeline
> runs end to end with real LLM scoring, real embeddings, and real pgvector
> similarity search. Enrichment runs against a seeded mock provider and the
> research stage emits a deterministic summary rather than doing live web
> research — both are deliberate seams, documented under
> [Current seams](#current-seams). From the
> [Phase 2 design](docs/design/2026-07-23-phase2-design.md), the hardening
> items (idempotent routing and seed; env parsing and queues in the shared
> package are lazy, so importing it opens no Redis connection) and the scoring
> eval harness are done; the real research loop is next.

## Demo

[**Watch the 44-second demo**](docs/media/signal-demo.mp4) — one real lead run in
real time, then four leads fired at the same pipeline (replayed at 4×) landing
four different tiers, each with its stored reasoning. Every command, timing,
score and quote in it comes from a captured run with `gpt-6-luna`.

## Pipeline

```
POST /ingest ──▶ enrich ──▶ research ──▶ score ──▶ embed ──▶ route ──▶ routing_events
                   │           │           │         │         │
              firmographic  account    LLM score  pgvector  rules engine
                waterfall   summary   + reasoning  vs.       (slack / crm /
                                      + tier       closed-won  suppressed)
                                      + confidence
```

Each stage is its own BullMQ queue. A lead is a job that advances one stage at
a time, so a failure is isolated to the stage that caused it and the completed
work upstream is never recomputed. Each stage gets three attempts with
exponential backoff (1s, 2s); exhausting them sets the lead's status to
`dead_letter` and keeps the failed job (with its error) in BullMQ's failed set,
rather than silently dropping the lead or leaving it wedged mid-pipeline.

## Why it's built this way

**Explainability is a schema decision, not a prompt suffix.** The `Score` model
persists `reasoning`, `tier`, and `confidence` as first-class columns alongside
the number. A rep — or an auditor asking why an account was skipped — reads the
stored justification, not a regenerated one that may no longer match the score
it's explaining.

**Scoring uses OpenAI strict Structured Outputs**, not prompt-and-parse. The
model (`gpt-6-luna` by default, overridable with `SCORING_MODEL`) is handed a
JSON Schema it must satisfy, so a malformed score is a transport-level failure
that retries, rather than a parse error discovered three stages downstream. The
prompt carries the lead's identity and inbound signal, flags any firmographics
enrichment could not supply, and requires the reasoning to assess every ICP
criterion as met, not met, or unknown, with each bullet citing a provided fact
— unknown never counts as fit.
`pnpm eval` measures tier agreement and run-to-run stability on a labeled
golden set.

**Similarity runs against your own closed-won accounts.** The embed stage
stores each lead's embedding, and the route stage finds the nearest seeded
closed-won account by pgvector cosine similarity and attaches it to the routing
decision ("looks like Globex, 0.73"), so a rep sees which won customer the lead
resembles. Similarity is evidence shown alongside the score today; it does not
yet feed the score or the routing rule.

**Routing is a pure function of tier and confidence.** `decideAction(tier,
confidence)` is separate from the I/O that acts on it, so the escalation policy
is unit-testable without a Slack workspace or a CRM sandbox. Tier A at high
confidence alerts; A or B pushes to CRM; everything else is suppressed.

**Ingestion accepts one lead or a CSV**, and both paths converge on the same
zod validation (`rawLeadInputSchema` in `packages/shared`) and the same enqueue
logic — the batch path is not a second implementation that drifts from the
single-lead one. Invalid input is rejected with a 400 listing what is wrong; in
a CSV, valid rows are ingested and invalid rows are reported back by line
number (if no row is valid, the whole request is a 400). The CSV parser
handles quoted fields, CRLF, and a UTF-8 BOM.

## Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces — `apps/api`, `apps/worker`, `packages/shared` |
| API | Fastify + TypeScript |
| Queue | BullMQ + Redis (per-stage queues, exponential backoff, dead-letter) |
| Database | PostgreSQL + pgvector, Prisma |
| LLM | OpenAI strict Structured Outputs (scoring, `gpt-6-luna`), OpenAI embeddings (`text-embedding-3-small`) |
| Validation | zod (ingest payloads and env config) |
| Tests | vitest, per stage |
| Local infra | docker-compose (Postgres+pgvector, Redis) |

Shared types, config, Prisma client, and queue definitions live in
`packages/shared` so the API and worker cannot disagree about the shape of a
lead or the name of a stage.

## Data model

`Lead` → `EnrichedAccount` → `ResearchFinding` → `Score` → `Embedding` →
`RoutingEvent`, with `ClosedWonAccount` holding the reference set that
similarity is measured against. Each stage owns exactly one table and upserts
into it keyed on `leadId` (`routing_events` holds one decision per lead, replaced
on re-route), which is what makes a stage safe to re-run.

## Running it

Full walkthrough in [`docs/DEMO.md`](docs/DEMO.md) — ingest through routing,
then read the whole pipeline back out via `GET /leads/:id`.

```bash
cp .env.example .env      # set OPENAI_API_KEY
docker compose up -d      # Postgres (pgvector) :5434, Redis :6380
pnpm install
pnpm db:migrate && pnpm db:generate   # both load the root .env
pnpm seed                 # embed 3 closed-won reference accounts (safe to re-run)
pnpm --filter @signal/api dev
pnpm --filter @signal/worker dev
pnpm test                 # vitest, all packages
pnpm eval                 # live scoring eval on the golden set (uses the API key)
```

The unit tests need no Postgres, Redis, or `.env`. The one integration test
(`packages/shared/src/db.test.ts`) runs whenever `DATABASE_URL` is set — which
the root `.env` does once you've copied `.env.example` — and then needs the
docker-compose Postgres up; without `DATABASE_URL` it is skipped.

## Design docs

The architecture was written down before it was built:

- [Lead qualification design](docs/design/2026-07-23-lead-qualification-design.md)
  — component boundaries, data model, and the phased build plan.
- [Phase 2 design](docs/design/2026-07-23-phase2-design.md) — real research
  loop, hardening, and scoring validation.

## Current seams

These are stubbed on purpose, behind interfaces that the real implementations
drop into:

- **Enrichment** resolves through a `waterfall(providers, domain)` function
  currently backed by a single seeded `MockProvider` (`acme.com`,
  `northwind.io`, `brightbakery.com`). Unknown domains get no firmographics —
  the scorer is told which fields are missing and scores on the lead's identity
  and signal alone, at low confidence. Adding Apollo or Clearbit means
  appending a provider to the array — the merge order and fallback behavior
  are already the tested part.
- **Research** emits a deterministic summary built from firmographics
  (`rawFindings: { stub: true }` marks it as such in the database). The live
  web-research loop is Phase 2; the stage boundary, retry semantics, and
  persistence around it are already in place.
- **Routing actions** are logged and persisted to `routing_events` rather than
  posting to a live Slack or CRM. The decision logic — the part with the
  interesting failure modes — is real and tested.

## What's next

- Score more than one lead at a time. Workers run with BullMQ's default
  concurrency of 1 job per stage, so leads queue behind the scorer: in a
  captured run of four leads, the last waited ~30 s before scoring started.
  Setting `concurrency` on the score worker (`apps/worker/src/runner.ts`) is
  the fix, bounded by the OpenAI rate limit.
- Real research loop (web search + summarization) replacing the stub
- Grow the scoring golden set (`scripts/eval-scoring.ts`) beyond 9 synthetic
  accounts, ideally with real labeled leads
- Meilisearch for operator-facing account lookup
- A frontend; the engine currently has no UI beyond the API
