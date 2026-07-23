# Signal — Vertical Slice Demo

End-to-end manual run of the lead-qualification pipeline: ingest → enrich →
research → score → embed → route, then read the full pipeline view back out.

## Prereqs

1. **Populate `.env`** (copy from `.env.example`, then fill in the two keys):
   ```bash
   cp .env.example .env
   ```
   Set real values for:
   - `ANTHROPIC_API_KEY` — used by the scoring stage.
   - `OPENAI_API_KEY` — used by the embedding stage and the seed script.

   `DATABASE_URL` and `REDIS_URL` are already set to match `docker-compose.yml`:
   - Postgres (pgvector) on host port **5434**
   - Redis on host port **6380**

2. **Start infrastructure:**
   ```bash
   docker compose up -d
   ```
   Wait for both services to report healthy (`docker compose ps`). Postgres
   listens on `localhost:5434`, Redis on `localhost:6380`.

3. **Install, migrate, generate the Prisma client:**
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
   automatically (`dotenv -e .env -- tsx …`) and inserts three embedded
   closed-won accounts. Expect three `seeded <company>` log lines.

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
   - `score` — `score`, `tier`, non-empty `reasoning[]`, `confidence`
   - `routing` — the emitted routing event(s)

This is the Phase 1 exit criterion: a lead ingested via the API is enriched,
researched, scored (with a tier and reasoning), matched, routed, and readable
back through `GET /leads/:id`.
