-- Migration: 001_create_diagnostic_leads_table.sql
-- Description: Creates the diagnostic_leads table for durable lead intake, partial step 2 capture, atomic queue claiming, and GHL retry queuing.

CREATE TABLE IF NOT EXISTS diagnostic_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id VARCHAR(128) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(64),
    name VARCHAR(255),
    language VARCHAR(10) DEFAULT 'en',
    funnel_status VARCHAR(20) NOT NULL DEFAULT 'partial' CHECK (funnel_status IN ('partial', 'completed')),
    source VARCHAR(255),
    source_page TEXT,
    landing_page TEXT,
    referrer TEXT,
    utm_source VARCHAR(255),
    utm_medium VARCHAR(255),
    utm_campaign VARCHAR(255),
    utm_content VARCHAR(255),
    utm_term VARCHAR(255),
    service VARCHAR(255),
    diagnostic_answers JSONB DEFAULT '{}'::jsonb,
    score INT,
    score_tier VARCHAR(50),
    monthly_loss NUMERIC(12, 2),
    consent BOOLEAN DEFAULT true,
    ghl_sync_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (ghl_sync_status IN ('pending', 'processing', 'synced', 'retry', 'failed')),
    retry_count INT NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    last_error TEXT,
    ghl_contact_id VARCHAR(128),
    ghl_opportunity_id VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ
);

-- Unique Constraint for Idempotent Submissions
CREATE UNIQUE INDEX IF NOT EXISTS idx_diagnostic_leads_submission_id ON diagnostic_leads (submission_id);

-- Lookup & Queue Performance Indexes
CREATE INDEX IF NOT EXISTS idx_diagnostic_leads_email ON diagnostic_leads (email);
CREATE INDEX IF NOT EXISTS idx_diagnostic_leads_phone ON diagnostic_leads (phone);
CREATE INDEX IF NOT EXISTS idx_diagnostic_leads_retry ON diagnostic_leads (ghl_sync_status, next_retry_at) 
    WHERE ghl_sync_status IN ('pending', 'retry', 'processing');

-- Enable Row Level Security (RLS)
ALTER TABLE diagnostic_leads ENABLE ROW LEVEL SECURITY;

-- Revoke public, anon, and authenticated client access (Server-Role Only)
REVOKE ALL ON diagnostic_leads FROM PUBLIC, anon, authenticated;
GRANT ALL ON diagnostic_leads TO service_role;

-- Trigger for Auto-Updating updated_at Timestamp
CREATE OR REPLACE FUNCTION update_diagnostic_leads_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_diagnostic_leads_timestamp ON diagnostic_leads;
CREATE TRIGGER trg_update_diagnostic_leads_timestamp
    BEFORE UPDATE ON diagnostic_leads
    FOR EACH ROW
    EXECUTE FUNCTION update_diagnostic_leads_timestamp();

-- Atomic Queue Claiming Function with Stuck Processing Recovery
CREATE OR REPLACE FUNCTION claim_pending_diagnostic_leads(p_limit INT DEFAULT 10)
RETURNS SETOF diagnostic_leads AS $$
BEGIN
    RETURN QUERY
    UPDATE diagnostic_leads
    SET ghl_sync_status = 'processing',
        updated_at = NOW()
    WHERE id IN (
        SELECT id FROM diagnostic_leads
        WHERE (ghl_sync_status IN ('pending', 'retry')
               AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
           OR (ghl_sync_status = 'processing'
               AND updated_at < NOW() - INTERVAL '15 minutes') -- Recover stuck jobs after 15 mins
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION claim_pending_diagnostic_leads(INT) TO service_role;

/*
-- ==============================================================================
-- REMOTE MIGRATION VERIFICATION SQL
-- Run these queries after applying the migration to confirm database readiness:
--
-- 1. Verify Table Structure & Constraints:
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'diagnostic_leads';
--
-- 2. Verify RLS Policy:
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'diagnostic_leads';
--
-- 3. Verify Function Execution:
-- SELECT * FROM claim_pending_diagnostic_leads(1);
--
-- ==============================================================================
-- ROLLBACK INSTRUCTIONS (NON-DESTRUCTIVE / REVERSIBLE)
-- To revert this migration, execute:
--
-- DROP FUNCTION IF EXISTS claim_pending_diagnostic_leads(INT);
-- DROP TRIGGER IF EXISTS trg_update_diagnostic_leads_timestamp ON diagnostic_leads;
-- DROP FUNCTION IF EXISTS update_diagnostic_leads_timestamp();
-- DROP TABLE IF EXISTS diagnostic_leads CASCADE;
-- ==============================================================================
*/
