# Signal — Design Doc

**AI-Powered Lead Qualification & Account-Matching Engine**
Author: Shashank Singh · Date: 2026-07-23 · Status: Approved for planning

This document records the architectural decisions, component boundaries, and
phased build plan for Signal. It is the source of truth the implementation
followed.

> **Implementation status (2026-11-24).** This is the original plan; the code
> has since diverged in these places — the README describes current behavior:
> - **LLM:** scoring uses **OpenAI** strict Structured Outputs (`gpt-6-luna`
>   by default), not Claude tool-use. No Anthropic key or SDK is used.
>   Research is still a deterministic stub (§4.3); the Phase 2 design moves it
>   to OpenAI web search, not Claude.
> - **Not built yet:** the Next.js dashboard (`apps/web`, §4.7), HubSpot and
>   Slack integrations and their idempotency keys (§4.6 — routing logs and
>   persists to `routing_events`), research caching, and api/worker/web
>   services in docker-compose (it runs Postgres and Redis only).
> - **Smaller differences:** 3 seeded closed-won accounts (not 10–20); the
>   route payload carries the top-1 similar account (not top-3); the ICP is
>   the `DEFAULT_ICP` constant in `apps/worker/src/score.ts`, not external
>   config; enrichment gaps are flagged to the scorer in the prompt
>   ("Missing firmographics: …"); tier A + high confidence routes to a single
>   `slack_alert` action rather than both HubSpot and Slack.

---

## 1. Purpose & Framing

Turn raw top-of-funnel signal (form fills, intent data, job postings, funding
news) into a **prioritized, explainable, actioned** list of accounts. Signal
ingests raw account signal, enriches it, has an AI agent research and reason
about fit, cross-references against best historical customers via vector
similarity, and routes only genuinely qualified accounts into the CRM — with a
human-readable explanation attached to every decision.

This is a **GTM Engineering portfolio project**: demoable in under 5 minutes,
production-*shaped* (queues, retries, dead-letter), single-tenant.

### Success criteria
- One lead flows through all 7 stages end-to-end producing a real score,
  reasoning, and closed-won similarity match.
- Every score ships with defensible, human-readable reasoning (not a bare number).
- A screen-shareable dashboard demo runs in ≤ 90 seconds.
- The architecture visibly handles retries, missing enrichment data, and
  dead-letter failures.

---

## 2. Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend language | **Node.js + TypeScript** | Fastest time-to-demo; richest SDK ecosystem (BullMQ, HubSpot, Anthropic, OpenAI). Project is judged on the AI/GTM system, not the web framework. |
| HTTP framework | **Fastify** | Lighter and better-typed than Express; first-class TS. |
| Queue / orchestration | **BullMQ + Redis** | Per-stage jobs with retries, backoff, dead-letter. |
| Database | **PostgreSQL + pgvector** | Relational data + cosine vector search in one engine. |
| ORM / migrations | **Prisma** | Typed schema, easy migrations; pgvector via raw SQL for the vector column/queries. |
| Reasoning / research / scoring | **Claude API (Anthropic)** | Tool-use for schema-enforced JSON; server-side web search tool for the research agent. |
| Embeddings | **OpenAI `text-embedding-3-small` (1536-dim)** | Cheap, high quality; API key available. Anthropic has no embeddings API. |
| Enrichment + intent signals | **Mocked/seeded behind a real interface** | Real interface + waterfall logic; swap to Apollo/Clearbit later is a one-file change. "Real where free, mock the rest." |
| CRM | **HubSpot free tier (real)** | Industry-standard, well-documented API. |
| Alerting | **Slack Incoming Webhook (real)** | Trivial to wire, high demo impact. |
| Dashboard | **Next.js (App Router) + React** | Reads the same Postgres; highest-impact demo surface. |
| Local dev | **Docker Compose** | pg+pgvector, redis, api, worker, web. One command to run. |

### Shaping principle
**Vertical slice first.** Build one lead end-to-end through all 7 stages with a
thin-but-real implementation of each stage, *then* broaden depth. Demoable
pipeline on ~day 3, not week 3; the scary parts (agentic research, structured
scoring, vector match) are de-risked immediately.

---

## 3. Architecture

```
┌──────────────┐   ┌─────────────┐   ┌────────────────┐   ┌────────────────┐
│  Ingestion    │──▶│  Enrichment  │──▶│ Research Agent  │──▶│ Scoring Engine  │
│ (CSV/Webhook) │   │ (mock+water- │   │ (Claude + web   │   │ (Claude, strict │
│               │   │  fall iface) │   │  search, cached)│   │  JSON tool-use) │
└──────────────┘   └─────────────┘   └────────────────┘   └───────┬────────┘
                                                                    │
                                                                    ▼
┌──────────────┐   ┌─────────────┐   ┌────────────────┐   ┌────────────────┐
│ CRM / Slack   │◀──│ Routing      │◀──│ Vector Match    │◀──│ Embedding Store │
│ (HubSpot,     │   │ (rules       │   │ (cosine vs      │   │ (OpenAI embed → │
│  Slack, log)  │   │  engine)     │   │  closed-won)    │   │  pgvector)      │
└──────────────┘   └─────────────┘   └────────────────┘   └────────────────┘
```

**Processing model:** async job queue. Each lead is a job that moves through
pipeline stages. Each stage: *read row → do work → write row → enqueue next
stage*. Stages are isolated units — a stage knows nothing about the next stage;
BullMQ is the only coupling.

**Repository layout (TS monorepo, pnpm workspaces):**
```
/apps
  /api        Fastify HTTP server: ingestion endpoints, read APIs for dashboard
  /worker     BullMQ workers: one processor per pipeline stage
  /web        Next.js dashboard
/packages
  /shared     Types (Lead, EnrichedAccount, Score…), db client, queue defs, config
```

---

## 4. Components

Each stage is an isolated unit with a typed input, typed output, and one job.

### 4.1 Ingestion (`apps/api`)
- **In:** CSV upload endpoint + mock webhook endpoint (job postings, funding,
  tech change, form fill — hand-seeded or from a public RSS/job feed).
- **Out:** normalized `RawLead` → `leads` row (`status = queued`) → enqueue `enrich`.
```ts
interface RawLead {
  domain: string;
  companyName?: string;
  source: "csv" | "webhook";
  signalType?: "job_posting" | "funding" | "tech_change" | "form_fill";
  signalPayload?: Record<string, unknown>;
  receivedAt: string;
}
```

### 4.2 Enrichment (`apps/worker`)
- `EnrichmentProvider` interface; default `MockProvider` returns seeded
  firmographics keyed by domain.
- **Waterfall (real logic):** `try A → if key fields missing, fall back to B`.
- Normalizes to `EnrichedAccount` (employee count, industry, tech stack[],
  funding stage, HQ location) → writes `enriched_accounts` → enqueue `research`.
- Missing-data handling: partial records allowed; gaps flagged for the scorer.

### 4.3 Research Agent (`apps/worker`)
- Claude agent loop with the **web search tool**:
  1. Search: `"{company} recent news"`, `"{company} tech stack"`, `"{company} hiring {role}"`.
  2. Summarize into 3–5 bullets.
  3. Persist raw findings + summary.
- **Caching:** keyed by domain, TTL of N days — re-runs don't re-search
  (cost control + the Recall-style memory instinct). Writes `research_findings`
  → enqueue `score`.

### 4.4 Scoring Engine (`apps/worker`)
- Claude call given: configurable **ICP definition**, enriched firmographics,
  research summary.
- **Strict JSON via tool-use** (schema-enforced, not prompt-hoped):
```json
{
  "score": 78,
  "tier": "A",
  "reasoning": [
    "Company raised Series B 3 months ago — budget signal",
    "Job posting for 'RevOps Manager' indicates GTM tooling gap",
    "No existing CRM detected in tech stack scan"
  ],
  "confidence": "high"
}
```
  `tier ∈ {A,B,C,disqualified}`, `confidence ∈ {high,medium,low}`.
- Writes `scores` → enqueue `embed`. **This explainability layer is the highest-
  leverage design decision in the project.**

### 4.5 Embedding & Vector Match (`apps/worker`)
- Seed 10–20 realistic **closed-won** reference accounts (embedded on setup).
- Embed lead's `firmographic + research summary` text via OpenAI
  `text-embedding-3-small`.
- pgvector cosine search → top-3 similar closed-won.
```sql
SELECT account_id, company_name, 1 - (embedding <=> $1) AS similarity
FROM closed_won_accounts
ORDER BY embedding <=> $1
LIMIT 3;
```
- Surfaces: *"87% similar to Acme Corp, your #2 largest closed deal."* Writes
  `embeddings` → enqueue `route`.

### 4.6 Routing (`apps/worker`)
- Small rules engine (deliberately not over-engineered):
  - tier A + high confidence → HubSpot "Hot" + Slack alert (reasoning inline)
  - tier B → HubSpot "Nurture"
  - disqualified → logged, not routed
- **HubSpot:** create/update Contact + Company; custom properties `ai_score`,
  `ai_reasoning`, `similar_account`. **Idempotency key** on writes so retries
  don't duplicate objects.
- **Slack:** incoming webhook for tier-A with reasoning bullets.
- Every action → `routing_events`.

### 4.7 Dashboard (`apps/web`)
- Leads table: score, tier, reasoning (expandable), similarity match, per-stage
  status. Dead-letter view for failed jobs. Reads the same Postgres.

### Reliability (cross-cutting)
- Every stage: retries + exponential backoff.
- Terminal failures → **dead-letter queue**, surfaced on the dashboard.
- CRM writes idempotent via idempotency keys.

---

## 5. Data Model

```
leads
  id, domain, company_name, source, signal_type, status, created_at

enriched_accounts
  lead_id (FK), employee_count, industry, tech_stack[], funding_stage, hq_location

research_findings
  lead_id (FK), summary, raw_findings (jsonb), researched_at   -- cache TTL by domain

scores
  lead_id (FK), score, tier, reasoning (jsonb), confidence, scored_at

closed_won_accounts
  id, company_name, firmographics (jsonb), embedding vector(1536), source_text

embeddings
  lead_id (FK), embedding vector(1536), source_text

routing_events
  lead_id (FK), action ("crm_push"|"slack_alert"|"suppressed"), payload (jsonb), timestamp
```

`status` on `leads` tracks pipeline position:
`queued → enriching → researching → scoring → matching → routing → done | dead_letter`.

---

## 6. Phased Build Plan

### Phase 0 — Foundation (½–1 day)
Docker Compose (pg+pgvector, redis); pnpm monorepo (`api`/`worker`/`web`/`shared`);
Prisma schema for all tables + pgvector migration; BullMQ queue definitions;
health checks.
**Exit:** `docker compose up` moves a dummy job across all stages (no-op processors).

### Phase 1 — Vertical slice, thin (2–3 days)
One seeded lead flows ingest → route with the *simplest real* version of each stage:
mock enrichment, real Claude scoring on stubbed research, real OpenAI embedding +
match against 3 seeded closed-won, console "route".
**Exit:** one lead produces a real score + reasoning + similarity match, visible via API.

### Phase 2 — Make each stage real & good (3–4 days)
Real agentic research loop + domain caching; scoring prompt tuned & validated on
~10 hand-checked accounts; enrichment waterfall; real HubSpot + Slack routing with
idempotency; 20–30 seeded leads; dead-letter path.
**Exit:** a batch of leads routed correctly to HubSpot/Slack with defensible reasoning.

### Phase 3 — Dashboard & demo polish (2 days)
Next.js leads table, expandable reasoning, similarity, dead-letter view; seed
script; README + 90-second demo GIF.
**Exit:** screen-shareable demo.

### Phase 4 — Stretch (optional, if time allows)
- Rep feedback loop: "not a fit" → few-shot correction in future scoring prompts.
- Multi-signal fusion: weight signals (funding > generic job posting).
- ICP A/B: two prompt versions, compare score distributions.

---

## 7. GTM / Interview Layer

Deliverables that make the project interview-worthy (built alongside the code):

- **ICP definition** (configurable, shipped as config): e.g. "B2B SaaS, 50–500
  employees, uses Salesforce, raised Series A+."
- **5-minute demo script** + 90-second dashboard walkthrough.
- **Talking points mapped to code:**
  - Explainability over black-box scoring → `scores.reasoning`, scoring prompt.
  - Vector similarity to closed-won → pgvector cosine query, embedding choice.
  - Async production-shaped architecture → BullMQ retries + dead-letter.
  - Cost/latency of LLM calls at scale → research caching, model selection.
  - Handling messy/missing enrichment → waterfall + partial-record flagging.
  - Scaling 30 → 30,000 leads → queue concurrency, batch embedding, cache hit rate.

---

## 8. Non-Goals

- Not a general-purpose CRM replacement.
- Not multi-tenant SaaS (single workspace is fine).
- Not optimizing enrichment source breadth (mock + 1 real source proves the pattern).

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Claude structured output drifts from schema | Enforce via tool-use schema, not prompt; validate + retry on parse failure. |
| Web search cost/latency in research loop | Cache by domain (TTL N days); cap search calls per lead. |
| HubSpot free-tier rate/property limits | Idempotency keys; batch/backoff; degrade to log-only if quota hit. |
| pgvector index tuning | Start exact search on small N (10–20 closed-won); add IVFFlat/HNSW only if scaling talking point needs it. |
| Demo depends on external APIs | Mock enrichment offline by default; seed script makes the demo deterministic. |
