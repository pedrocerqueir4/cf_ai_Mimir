import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

type BattlePoolPayload = { topic: string; poolTopicId: string; topicEmbedding?: number[] };

export class BattleQuestionGenerationWorkflow extends WorkflowEntrypoint<Env, BattlePoolPayload> {
  async run(_event: WorkflowEvent<BattlePoolPayload>, _step: WorkflowStep) {
    // Plan 03 implements: generate-20-questions → upsert-topic-vector → mark-pool-ready
    throw new Error("BattleQuestionGenerationWorkflow not yet implemented");
  }
}
