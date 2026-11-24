-- Idempotent routing + idempotent seed (Phase 2 design §3.2, §3.3).
-- Earlier versions could insert duplicates (re-running `pnpm seed`, re-running
-- the route stage). Collapse them first so the unique indexes can be created.

-- Keep the latest routing event per lead.
DELETE FROM "routing_events" a
USING "routing_events" b
WHERE a."lead_id" = b."lead_id"
  AND (a."timestamp", a."id") < (b."timestamp", b."id");

-- Keep one closed-won account per company name.
DELETE FROM "closed_won_accounts" a
USING "closed_won_accounts" b
WHERE a."company_name" = b."company_name"
  AND a."id" > b."id";

-- CreateIndex
CREATE UNIQUE INDEX "closed_won_accounts_company_name_key" ON "closed_won_accounts"("company_name");

-- CreateIndex
CREATE UNIQUE INDEX "routing_events_lead_id_key" ON "routing_events"("lead_id");
