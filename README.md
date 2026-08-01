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
> [Current seams](#current-seams). Phase 2 (real research loop, hardening,
> scoring eval harness) is designed in `docs/`.

## Pipeline

```
POST /ingest ──▶ enrich ──▶ research ──▶ score ──▶ embed ──▶ route ──▶ routing_events
                   │           │           │         │         │
              firmographic  account    LLM score  pgvector  rules engine
                waterfall   summary   + reasoning  vs.       (slack / crm /
                                      + tier       closed-won  hold)
                                      + confidence
```

Each stage is its own BullMQ queue. A lead is a job that advances one stage at
a time, so a failure is isolated to the stage that caused it and the completed
work upstream is never recomputed. Stages retry three times with exponential
backoff; exhausting retries dead-letters the job rather than silently dropping
the lead or leaving it wedged mid-pipeline.

## Why it's built this way

**Explainability is a schema decision, not a prompt suffix.** The `Score` model
persists `reasoning`, `tier`, and `confidence` as first-class columns alongside
the number. A rep — or an auditor asking why an account was skipped — reads the
stored justification, not a regenerated one that may no longer match the score
it's explaining.

**Scoring uses OpenAI strict Structured Outputs**, not prompt-and-parse. The
model is handed a JSON Schema it must satisfy, so a malformed score is a
transport-level failure that retries, rather than a parse error discovered
three stages downstream.

**Similarity runs against your own closed-won accounts.** Rather than scoring
fit against an abstract ICP description alone, the embed stage compares each
lead's embedding to seeded closed-won accounts via pgvector cosine similarity.
"Looks like the customers you already win" is a stronger signal than "matches
the ICP paragraph someone wrote last quarter."

**Routing is a pure function of tier and confidence.** `decideAction(tier,
confidence)` is separate from the I/O that acts on it, so the escalation policy
is unit-testable without a Slack workspace or a CRM sandbox. Tier A at high
confidence alerts; A or B pushes to CRM; everything else holds.

**Ingestion accepts one lead or a CSV**, and both paths converge on the same
enqueue logic — the batch path is not a second implementation that drifts from
the single-lead one.

## Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces — `apps/api`, `apps/worker`, `packages/shared` |
| API | Fastify + TypeScript |
| Queue | BullMQ + Redis (per-stage queues, exponential backoff, dead-letter) |
| Database | PostgreSQL + pgvector, Prisma |
| LLM | OpenAI strict Structured Outputs (scoring), OpenAI embeddings |
| Validation | zod |
| Tests | vitest, per stage |
| Local infra | docker-compose (Postgres+pgvector, Redis) |

Shared types, config, Prisma client, and queue definitions live in
`packages/shared` so the API and worker cannot disagree about the shape of a
lead or the name of a stage.

## Data model

`Lead` → `EnrichedAccount` → `ResearchFinding` → `Score` → `Embedding` →
`RoutingEvent`, with `ClosedWonAccount` holding the reference set that
similarity is measured against. Each stage owns exactly one table and upserts
into it keyed on `leadId`, which is what makes a stage safe to re-run.

## Running it

Full walkthrough in [`docs/DEMO.md`](docs/DEMO.md) — ingest through routing,
then read the whole pipeline back out via `GET /leads/:id`.

```bash
cp .env.example .env      # set OPENAI_API_KEY
docker compose up -d      # Postgres (pgvector) :5434, Redis :6380
pnpm install
pnpm db:migrate && pnpm db:generate
pnpm seed                 # embed 3 closed-won reference accounts
pnpm --filter @signal/api dev
pnpm --filter @signal/worker dev
pnpm test                 # vitest, all packages
```

## Current seams

These are stubbed on purpose, behind interfaces that the real implementations
drop into:

- **Enrichment** resolves through a `waterfall(providers, domain)` function
  currently backed by a single seeded `MockProvider`. Adding Apollo or Clearbit
  means appending a provider to the array — the merge order and fallback
  behavior are already the tested part.
- **Research** emits a deterministic summary built from firmographics
  (`rawFindings: { stub: true }` marks it as such in the database). The live
  web-research loop is Phase 2; the stage boundary, retry semantics, and
  persistence around it are already in place.
- **Routing actions** are logged and persisted to `routing_events` rather than
  posting to a live Slack or CRM. The decision logic — the part with the
  interesting failure modes — is real and tested.

## What's next

- Real research loop (web search + summarization) replacing the stub
- Scoring eval harness — a labeled set to measure whether prompt changes
  actually improve agreement, instead of eyeballing a handful of leads
- Meilisearch for operator-facing account lookup
- A frontend; the engine currently has no UI beyond the API
