import { DurableObject } from "cloudflare:workers";

export class BattleRoom extends DurableObject<Env> {
  // Plan 02 adds: acceptWebSocket, webSocketMessage, webSocketClose, alarm()
  async fetch(_request: Request): Promise<Response> {
    return new Response("BattleRoom not yet implemented", { status: 501 });
  }
}
