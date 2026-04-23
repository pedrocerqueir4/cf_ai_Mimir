-- Disambiguate colliding chat_messages.created_at values within the same
-- conversation by adding a small per-row offset derived from the count
-- of rows sharing the same (conversation_id, created_at) that were
-- inserted earlier (lower rowid). This preserves insertion order as the
-- tie-break across rows that migration 0008 left at identical millisecond
-- timestamps (the original seconds-precision bug).
--
-- New rows written after the schema change to mode:"timestamp_ms" already
-- use +1 ms / +2 ms offsets, so they are not affected by this statement
-- (their matching subquery count is zero). Pure backfill for legacy rows.
UPDATE `chat_messages`
SET `created_at` = `created_at` + (
  SELECT COUNT(*)
  FROM `chat_messages` AS `c2`
  WHERE `c2`.`conversation_id` = `chat_messages`.`conversation_id`
    AND `c2`.`created_at` = `chat_messages`.`created_at`
    AND `c2`.`rowid` < `chat_messages`.`rowid`
);
