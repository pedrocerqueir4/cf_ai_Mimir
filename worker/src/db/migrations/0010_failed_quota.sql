-- Migration 0010: Add error_message column to roadmaps table.
-- Used when status='failed_quota' to store the verbatim QUOTA_EXHAUSTED_MESSAGE
-- so the GET /api/chat/status/:workflowRunId endpoint can surface it to the UI.
-- SQLite enums are enforced only at the Drizzle layer (the column is plain TEXT
-- in SQLite), so no ALTER statement is needed for the 'failed_quota' enum addition.
ALTER TABLE roadmaps ADD COLUMN error_message TEXT;
