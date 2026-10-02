import { handle } from "@astrojs/cloudflare/handler";
import { DurableObject } from "cloudflare:workers";
import { act, newGame, view, type Game } from "./lib/game";

export class DeckRoom extends DurableObject {
  async fetch(request: Request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const id = request.headers.get("x-player-id")!;
      const game = (await this.ctx.storage.get<Game>("game-v2")) ?? newGame();
      if (request.method === "POST") {
        try {
          const body = await request.text();
          if (body.length > 20000) return new Response(null, { status: 413 });
          act(game, id, JSON.parse(body));
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "Solicitud inválida.",
            },
            { status: 400 },
          );
        }
      } else if (request.method !== "GET")
        return new Response(null, { status: 405 });
      await this.ctx.storage.put("game-v2", game);
      return Response.json(view(game, id), {
        headers: { "cache-control": "no-store" },
      });
    });
  }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/deck")
      return new Response("Usa una sala.", { status: 410 });
    if (url.pathname.startsWith("/api/rooms/")) {
      const roomId = url.pathname.slice("/api/rooms/".length);
      if (!/^[a-f0-9]{32}$/.test(roomId))
        return new Response(null, { status: 400 });
      if (
        request.method === "POST" &&
        request.headers.get("origin") !== url.origin
      )
        return new Response(null, { status: 403 });
      if (Number(request.headers.get("content-length")) > 20000)
        return new Response(null, { status: 413 });
      const cookie = request.headers
        .get("cookie")
        ?.match(/(?:^|;\s*)loteria-id=([a-f0-9-]{36})(?:;|$)/)?.[1];
      const id = cookie ?? crypto.randomUUID();
      const headers = new Headers(request.headers);
      headers.set("x-player-id", id);
      const room = env.DECK_ROOM.get(
        env.DECK_ROOM.idFromName(`room-${roomId}`),
      );
      const response = await room.fetch(new Request(request, { headers }));
      const result = new Response(response.body, response);
      if (!cookie)
        result.headers.append(
          "set-cookie",
          `loteria-id=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${url.protocol === "https:" ? "; Secure" : ""}`,
        );
      return result;
    }
    return handle(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
