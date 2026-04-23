-- Convert chat_messages.created_at from unix seconds to unix milliseconds
-- so the +1 ms / +2 ms offsets used by POST /api/chat/message actually
-- preserve strict ordering between user message → roadmap ack → streamed
-- reply in the same request. Before this fix all three collapsed to the
-- same second and the client-side render order was undefined.
--
-- Safe: existing rows are second-precision; multiplying preserves them.
-- New rows are written by Drizzle with mode: "timestamp_ms" (see schema.ts).
UPDATE `chat_messages` SET `created_at` = `created_at` * 1000;
