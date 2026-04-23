-- Chat history pagination support.
-- Composite index powers the cursor-paginated GET endpoint
-- (SELECT ... WHERE user_id=? AND conversation_id=? AND created_at < ? ORDER BY created_at DESC LIMIT ?)
-- and the DESC ordering matches the query plan exactly so SQLite can walk the
-- index in reverse without an extra sort step.
CREATE INDEX IF NOT EXISTS `idx_chat_messages_user_conv_created`
  ON `chat_messages` (`user_id`, `conversation_id`, `created_at` DESC);
