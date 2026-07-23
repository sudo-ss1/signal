-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('queued', 'enriching', 'researching', 'scoring', 'matching', 'routing', 'done', 'dead_letter');

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "company_name" TEXT,
    "source" TEXT NOT NULL,
    "signal_type" TEXT,
    "signal_payload" JSONB,
    "status" "LeadStatus" NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enriched_accounts" (
    "lead_id" TEXT NOT NULL,
    "employee_count" INTEGER,
    "industry" TEXT,
    "tech_stack" TEXT[],
    "funding_stage" TEXT,
    "hq_location" TEXT,

    CONSTRAINT "enriched_accounts_pkey" PRIMARY KEY ("lead_id")
);

-- CreateTable
CREATE TABLE "research_findings" (
    "lead_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "raw_findings" JSONB NOT NULL,
    "researched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_findings_pkey" PRIMARY KEY ("lead_id")
);

-- CreateTable
CREATE TABLE "scores" (
    "lead_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "reasoning" JSONB NOT NULL,
    "confidence" TEXT NOT NULL,
    "scored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("lead_id")
);

-- CreateTable
CREATE TABLE "closed_won_accounts" (
    "id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "firmographics" JSONB NOT NULL,
    "source_text" TEXT NOT NULL,
    "embedding" vector(1536),

    CONSTRAINT "closed_won_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embeddings" (
    "lead_id" TEXT NOT NULL,
    "source_text" TEXT NOT NULL,
    "embedding" vector(1536),

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("lead_id")
);

-- CreateTable
CREATE TABLE "routing_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "enriched_accounts" ADD CONSTRAINT "enriched_accounts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_events" ADD CONSTRAINT "routing_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

