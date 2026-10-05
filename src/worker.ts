import { handle } from "@astrojs/cloudflare/handler";
import { DurableObject } from "cloudflare:workers";
import { act, newGame, view, type Game } from "./lib/game";

import {
  validateStoredBoard,
  shortBoardId,
  isShortId,
  type StoredBoard,
} from "./lib/short-boards";
import { boardLink } from "./lib/printable-boards";

export class DeckRoom extends DurableObject {
  async fetch(request: Request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (new URL(request.url).pathname === "/internal/printed") {
        const stored =
          await this.ctx.storage.get<StoredBoard>("printed-board-v1");
        if (request.method === "PUT") {
          const record = validateStoredBoard(await request.json());
          if (stored && JSON.stringify(stored) !== JSON.stringify(record))
            return new Response("Conflicto de identificador.", { status: 409 });
          if (!stored) await this.ctx.storage.put("printed-board-v1", record);
          return Response.json(record);
        }
        if (request.method !== "GET")
          return new Response(null, { status: 405 });
        return stored
          ? Response.json(stored)
          : new Response("Cartón no encontrado.", { status: 404 });
      }
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
    if (url.pathname === "/api/printed") {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      if (request.headers.get("origin") !== url.origin)
        return new Response(null, { status: 403 });
      try {
        const raw = await request.text();
        if (raw.length > 20000)
          return Response.json(
            { error: "Lote demasiado grande." },
            { status: 413 },
          );
        const input = JSON.parse(raw);
        if (
          !Array.isArray(input.boards) ||
          !input.boards.length ||
          input.boards.length > 100
        )
          throw new Error("Elige entre 1 y 100 cartones.");
        const records = input.boards.map(validateStoredBoard);
        const ids: string[] = [];
        // Bounded concurrency: do not fan out 100 simultaneous durable objects.
        for (let offset = 0; offset < records.length; offset += 5) {
          const group = await Promise.all(
            records
              .slice(offset, offset + 5)
              .map(async (record: StoredBoard) => {
                const id = await shortBoardId(record);
                const object = env.DECK_ROOM.get(
                  env.DECK_ROOM.idFromName(`printed-${id}`),
                );
                const saved = await object.fetch(
                  new Request("https://internal/internal/printed", {
                    method: "PUT",
                    body: JSON.stringify(record),
                  }),
                );
                if (!saved.ok)
                  throw new Error(
                    "No se pudo guardar el cartón de forma segura.",
                  );
                return id;
              }),
          );
          ids.push(...group);
        }
        return Response.json(
          { ids },
          { headers: { "cache-control": "no-store" } },
        );
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error ? error.message : "Solicitud inválida.",
          },
          { status: 400 },
        );
      }
    }
    if (
      url.pathname.startsWith("/c/") ||
      url.pathname.startsWith("/api/printed/")
    ) {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const redirect = url.pathname.startsWith("/c/");
      const id = url.pathname.slice(redirect ? 3 : "/api/printed/".length);
      if (!isShortId(id))
        return new Response("Cartón no encontrado.", { status: 404 });
      const object = env.DECK_ROOM.get(
        env.DECK_ROOM.idFromName(`printed-${id}`),
      );
      const response = await object.fetch(
        new Request("https://internal/internal/printed"),
      );
      if (!response.ok)
        return new Response(
          "No se encontró este cartón. Revisa el enlace impreso.",
          { status: 404 },
        );
      const record = validateStoredBoard(await response.json());
      if (redirect)
        return new Response(null, {
          status: 302,
          headers: {
            location: boardLink(
              record.token,
              url.origin,
              record.room,
              record.number,
            ),
            "cache-control": "no-store",
          },
        });
      return Response.json(record, {
        headers: { "cache-control": "no-store" },
      });
    }
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
