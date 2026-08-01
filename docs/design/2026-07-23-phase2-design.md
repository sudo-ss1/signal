# Signal — Phase 2 Design Doc

**Make the pipeline real & hardened (Research + Hardening + Scoring validation)**
Author: Shashank Singh · Date: 2026-07-23 · Status: Approved for planning

Builds on the merged vertical slice — see
[`2026-07-23-lead-qualification-design.md`](./2026-07-23-lead-qualification-design.md).
This cycle covers pieces
**A (real research)**, **D (scoring validation)**, and **E (hardening)** from the
original Phase 2 list. Real enrichment (B) and real HubSpot/Slack routing (C) are
explicitly deferred to a later cycle.

---

## 1. Purpose

Turn the slice's placeholder/known-rough spots into real, hardened behavior — without
adding external-credential dependencies beyond the OpenAI key already in use:

- **Research** becomes a real OpenAI web-search loop with domain caching.
- **Routing writes**, **the seed**, and **the shared package** become robust
  (idempotent, side-effect-free).
- **Scoring quality** gets a repeatable eval.

### Success criteria
- A fresh lead's research summary is produced from a live OpenAI web search, with
  source citations stored; a second lead on the same domain reuses the cache (no
  second API call) within the TTL.
- A web-search outage produces a degraded (enrichment-derived) summary and the lead
  still completes — it does not dead-letter.
- Re-running the pipeline for a lead does not create duplicate `routing_events`.
- Re-running `pnpm seed` does not duplicate closed-won accounts.
- Importing a type from `@signal/shared` does not parse env or open a Redis
  connection (unit tests run without a live Redis).
- `scripts/eval-scoring.ts` reports expected-vs-actual tier and score distribution
  over a labeled golden set.

---

## 2. Locked Decisions (this cycle)

| Decision | Choice | Rationale |
|---|---|---|
| Research backend | **OpenAI Responses API `web_search` tool** | Uses the existing OpenAI key; no Anthropic key available; no extra service. |
| Research caching | **Domain-keyed `research_cache` table**, TTL = `RESEARCH_CACHE_DAYS` | Cost control; matches the spec's "store researched facts so re-runs don't re-search". |
| Research failure | **Degraded fallback** (enrichment-derived summary, low confidence) | A search outage must not dead-letter a lead. |
| Enrichment | **Keep mock**, add a 2nd mock source to exercise the waterfall | Real enrichment breadth is a non-goal; no key. |
| Routing sink | **Console (unchanged)**; make writes idempotent | Real HubSpot/Slack deferred to a later cycle. |
| Scoring | **Contract unchanged**; add an eval script | Validate quality without changing behavior. |

**Exact OpenAI Responses API tool type and model support to be confirmed against
current OpenAI docs (context7) during planning.**

---

## 3. Component Changes

### 3.1 Research agent (replaces the stub)
`apps/worker/src/research.ts` — `researchHandler(leadId)` signature unchanged.

New collaborators:
- `researchCompany(client, domain, enriched): Promise<{ summary: string; findings: unknown }>`
  — calls the OpenAI **Responses API** with the `web_search` tool, prompted to
  research the company across **recent news / funding / tech stack / hiring** and
  return a **3–5 bullet summary** plus structured raw findings including source URLs.
  Client is **dependency-injected** for testing.
- Cache read/write helpers over the new `research_cache` table.

`researchHandler` flow:
1. Load the lead (domain) and its `enriched_accounts` row.
2. `getCachedResearch(domain)` — if a row exists with
   `researched_at >= now - RESEARCH_CACHE_DAYS`, reuse `summary`/`findings`
   (cache hit; no API call).
3. On miss: `researchCompany(...)`. On success, `upsertResearchCache(domain, ...)`.
   On error, build a **degraded** summary from enrichment (reuse the slice's
   `buildStubSummary` logic) and mark the finding `{ degraded: true }` — do NOT throw.
4. Upsert the per-lead `research_findings` row (so the read API is unchanged) with the
   chosen summary + `raw_findings`.
5. Runner advances to `score`.

### 3.2 Idempotent routing
- Prisma: add `@unique` to `RoutingEvent.leadId`; migration.
- `apps/worker/src/route.ts`: `prisma.routingEvent.create` → `upsert` keyed on
  `leadId` (create-or-replace; one routing event per lead, latest wins). All other
  routeHandler logic unchanged.

### 3.3 Idempotent seed
- Prisma: add `@unique` to `ClosedWonAccount.companyName`; migration.
- `scripts/seed-closed-won.ts`: raw insert gains
  `ON CONFLICT (company_name) DO UPDATE SET firmographics = EXCLUDED.firmographics,
  source_text = EXCLUDED.source_text, embedding = EXCLUDED.embedding`.
  Re-seeding updates in place instead of duplicating. Also `process.exit(0)` / clean
  `$disconnect()` so the script exits promptly.

### 3.4 Side-effect-free `@signal/shared`
Problem: importing the barrel parses env (zod at module load in `config.ts`) and
constructs 5 BullMQ `Queue`s (`queues.ts`), so importing a type opens Redis.

Fix (lazy accessors, no behavior change for real callers):
- `config.ts`: parse lazily — `export const config` becomes a lazily-computed
  singleton (getter/`getConfig()` memoized on first access) so mere import doesn't throw.
- `queues.ts`: replace the eager `queues` map with `getQueue(stage): Queue<LeadJob>`
  (memoized), and `connection` derived lazily from config on first use.
- Update consumers (`apps/api/src/routes/ingest.ts`, `apps/worker/src/runner.ts`) to
  call `getQueue(...)`. `STAGES`/`nextStage`/types stay pure.
- Result: `import type { RawLead } from "@signal/shared"` and importing pure helpers
  cause no env parse and no Redis connection. Worker unit tests no longer need
  connection teardown.

### 3.5 Enrichment waterfall exercise (minor)
Add a second `MockProvider` (e.g. a "fallback" source with only partial fields) so the
waterfall's gap-filling path is real and unit-tested, per the slice's `waterfall`
contract. No new external calls.

### 3.6 Drop unused dependency
Remove `@anthropic-ai/sdk` from `apps/worker/package.json` (scoring is OpenAI now).

---

## 4. Data Model Delta

```
research_cache            -- NEW: domain-keyed research cache
  domain (PK), summary, raw_findings (jsonb), researched_at

routing_events
  + UNIQUE (lead_id)       -- enable idempotent upsert

closed_won_accounts
  + UNIQUE (company_name)  -- enable idempotent seed
```
`research_findings` (per-lead) is unchanged and still what the read API returns.

---

## 5. Scoring Validation (D)

`scripts/eval-scoring.ts`:
- A labeled golden set of ~8–10 **synthetic** accounts: at least one clear tier-A,
  a couple B/C, and one that should be `disqualified`, each with an `expectedTier`
  (or acceptable set).
- Runs `scoreAccount` (real OpenAI, DI client) over each; prints a table:
  `company | expectedTier | actualTier | score | match?` plus the score distribution
  and a mismatch count.
- Documented as the validation artifact; **not** part of the CI unit gate (hits the
  live API). Run via a `pnpm eval` script with `.env` loaded (dotenv), mirroring the
  seed command.

---

## 6. Testing Strategy

- **Unit (CI gate, no network):**
  - research: cache hit vs miss vs error→degraded, with a fake OpenAI client and a
    fake/seeded cache; assert no API call on hit, degraded summary on error.
  - route: upsert idempotency (second call for the same lead does not add a row) —
    tested at the pure/mocked level.
  - shared: importing types/`getQueue` does not throw without env; `getQueue`
    memoizes.
  - enrich: waterfall gap-fill across two mock sources.
- **Live (manual, key-gated):** one research web-search sanity call; the scoring eval;
  a full end-to-end run confirming research citations + cache reuse on a second lead.
- **Harness note (from the slice's debugging):** run exactly one worker; use
  process-group teardown; never `TRUNCATE`/drain BullMQ queues while jobs are in flight.

---

## 7. Non-Goals (this cycle)
- Real enrichment provider (Apollo/Clearbit) — deferred (B).
- Real HubSpot + Slack routing — deferred (C); console sink remains.
- The Next.js dashboard — deferred (Phase 3).
- Multi-signal weighting / feedback loop / ICP A-B — deferred (original Phase 4).

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| OpenAI `web_search` tool type/model differs from assumption | Confirm against current OpenAI docs (context7) in planning before coding. |
| Web search latency/cost per lead | Domain cache with TTL; one research call per uncached domain; cap tool iterations. |
| Search outage dead-letters leads | Degraded enrichment-derived fallback; never throw from researchHandler on search failure. |
| Lazy-config refactor breaks a consumer | Update all `config`/`queues` consumers; unit test import-without-env; run full suite + a live e2e. |
| research_findings vs research_cache divergence | Single write path: cache is source; per-lead row is copied from the chosen summary each run. |
| Idempotent-upsert migrations on existing rows | New unique constraints on fresh columns; dev DB has no conflicting duplicates (verified: closed_won=3 distinct, routing_events currently empty). |
