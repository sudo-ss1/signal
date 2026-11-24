# Signal — Vertical Slice Demo

End-to-end manual run of the lead-qualification pipeline: ingest → enrich →
research → score → embed → route, then read the full pipeline view back out.

## Prereqs

Tools: Node 20+, pnpm, Docker, and `jq` (used to read the API's JSON in the
run steps below).

1. **Populate `.env`** (copy from `.env.example`, then fill in the key):
   ```bash
   cp .env.example .env
   ```
   Set a real value for `OPENAI_API_KEY` — it is the only external credential,
   used by the scoring stage, the embedding stage, the seed script, and
   `pnpm eval`. Optionally set `SCORING_MODEL` (default `gpt-6-luna`).

   `DATABASE_URL` and `REDIS_URL` are already set to match `docker-compose.yml`:
   - Postgres (pgvector) on host port **5434**
   - Redis on host port **6380**

2. **Start infrastructure:**
   ```bash
   docker compose up -d
   ```
   Wait for both services to report healthy (`docker compose ps`). Postgres
   listens on `localhost:5434`, Redis on `localhost:6380`.

3. **Install, migrate, generate the Prisma client** (both `db:` scripts load
   the root `.env`, so nothing needs exporting first):
   ```bash
   pnpm install
   pnpm db:migrate
   pnpm db:generate
   ```

4. **Seed the closed-won reference accounts** (needed for vector similarity):
   ```bash
   pnpm seed
   ```
   This runs `scripts/seed-closed-won.ts` with the root `.env` loaded
   automatically (`dotenv -e .env -- tsx …`) and upserts three embedded
   closed-won accounts, then exits. Expect three `seeded <company>` log lines.
   Re-running it updates the accounts in place; it never duplicates them.

> Note: the `start`/`dev` scripts for both `@signal/api` and `@signal/worker`
> load the repo-root `.env` automatically (`dotenv -e ../../.env -- …`), so you
> do not need to export environment variables into your shell first.

## Run

1. **Terminal A — start the worker** (five stage workers on the BullMQ queues):
   ```bash
   pnpm --filter @signal/worker start
   ```
   → logs `[worker] started 5 stage workers`.

2. **Terminal B — start the API** (Fastify on port 3001):
   ```bash
   pnpm --filter @signal/api start
   ```
   → logs `Server listening at http://0.0.0.0:3001`. Confirm health:
   ```bash
   curl -s localhost:3001/health   # → {"ok":true}
   ```

3. **Terminal C — ingest one lead:**
   ```bash
   curl -s -XPOST localhost:3001/ingest \
     -H 'content-type: application/json' \
     -d '{"domain":"acme.com","companyName":"Acme Corp","source":"webhook","signalType":"funding"}'
   ```
   → returns `{"leadId":"..."}` (HTTP 202). Copy the `leadId`.

   Invalid input is rejected with HTTP 400 and a list of problems, e.g. a
   missing `source` (`csv` | `webhook`), an unknown `signalType`
   (`job_posting` | `funding` | `tech_change` | `form_fill`), or a URL instead
   of a bare domain.

   To ingest a batch instead, POST CSV text with a header row (`domain`
   required; `companyName`, `signalType` optional). Quoted fields work:
   ```bash
   curl -s -XPOST localhost:3001/ingest/csv -H 'content-type: text/csv' \
     --data-binary $'domain,companyName,signalType\nnorthwind.io,"Northwind, Inc",form_fill\n'
   ```
   → `{"leadIds":[...],"errors":[]}`; invalid rows appear in `errors` with
   their line number. If no row is valid, the response is HTTP 400
   `{"error":"no valid rows","leadIds":[],"errors":[...]}`.

4. **Watch Terminal A:** you should see the lead flow through each stage,
   ending in a route log line such as `[route] slack_alert {...}`.

5. **Fetch the full pipeline view** (use the `leadId` from step 3):
   ```bash
   curl -s localhost:3001/leads/<leadId> | jq
   ```
   → returns `{ lead, enriched, research, score, routing }`:
   - `lead.status` is `done`
   - `enriched` — firmographics + tech stack
   - `research` — research summary
   - `score` — `score`, `tier`, `reasoning[]` (evidence bullets), `confidence`
   - `routing` — the routing decision (an array holding at most one event;
     re-routing a lead replaces it). Its payload includes `similarAccount`,
     the nearest closed-won account and its cosine similarity.

This is the Phase 1 exit criterion: a lead ingested via the API is enriched,
researched, scored (with a tier and reasoning), matched, routed, and readable
back through `GET /leads/:id`.

## Optional: scoring eval

```bash
pnpm eval      # or: pnpm eval 5   (runs per case)
```
Scores the golden set in `scripts/eval-scoring.ts` against the live model and
prints expected vs. actual tier per run, tier agreement, run-to-run stability,
and the score distribution. Takes a couple of minutes with `gpt-6-luna`.
