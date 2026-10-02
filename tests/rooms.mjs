import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateBoards, decodeBoard } from "../src/lib/printable-boards.ts";
import { randomUUID } from "node:crypto";
const origin = process.env.TEST_ORIGIN ?? "http://localhost:8787";
const room = randomUUID().replaceAll("-", "");
const cookies = {};
async function call(who, action, target = room) {
  const response = await fetch(`${origin}/api/rooms/${target}`, {
    method: action ? "POST" : "GET",
    headers: {
      origin,
      ...(cookies[who] ? { cookie: cookies[who] } : {}),
      "content-type": "application/json",
    },
    ...(action ? { body: JSON.stringify(action) } : {}),
  });
  if (response.headers.get("set-cookie"))
    cookies[who] = response.headers.get("set-cookie").split(";")[0];
  return { status: response.status, body: await response.json() };
}
const cards = JSON.parse(
  await readFile(new URL("../src/lib/cards.json", import.meta.url)),
);
const printed = generateBoards(1)[0];
const physicalBoard = decodeBoard(printed.token);
await Promise.all(["a", "b", "p", "q"].map((w) => call(w)));
const results = await Promise.all(
  ["a", "b"].map((w) => call(w, { action: "admin" })),
);
assert.equal(
  results.filter((r) => r.status === 200).length,
  1,
  "single admin under concurrent claims",
);
const admin = results[0].status === 200 ? "a" : "b";
assert.equal((await call("p", { action: "draw" })).status, 400);
assert.equal(
  (
    await call("p", {
      action: "register",
      name: "Ana",
      boards: [cards.slice(0, 15)],
    })
  ).status,
  400,
);
assert.equal(
  (
    await call("p", {
      action: "register",
      name: "Ana",
      boards: [physicalBoard],
    })
  ).status,
  200,
);
assert.equal(
  (
    await call("q", {
      action: "register",
      name: "Luis",
      boards: [physicalBoard],
    })
  ).status,
  200,
);
assert.equal(
  (await call("p")).body.players.length,
  1,
  "player cannot inspect other boards",
);
assert.equal((await call(admin)).body.players.length, 2);
await call(admin, { action: "draw" });
assert.equal(
  (
    await call("p", {
      action: "register",
      name: "Cheat",
      boards: [physicalBoard],
    })
  ).status,
  400,
);
let game;
for (let i = 0; i < cards.length; i++) {
  game = (await call(admin)).body;
  if (game.paused) break;
  assert.equal((await call(admin, { action: "draw" })).status, 200);
}
assert.equal(game.paused, true);
assert.equal(
  game.claims.filter((c) => c.status === "pending").length,
  2,
  "simultaneous winners",
);
assert.equal(
  (await call(admin, { action: "draw" })).status,
  400,
  "pause during VAR",
);
const claim = game.claims.find((c) => c.status === "pending");
assert.deepEqual(
  claim.cards,
  physicalBoard,
  "VAR evidence matches the physical QR board in order",
);
assert.equal(claim.cards.filter((c) => claim.drawn.includes(c)).length, 16);
assert.equal(
  (await call("p")).body.claims.length,
  0,
  "VAR evidence is admin-only",
);
assert.equal(
  (await call("p", { action: "review", id: claim.id, verdict: "confirmed" }))
    .status,
  400,
);
const other = game.claims.find((c) => c.id !== claim.id);
assert.equal(
  (await call(admin, { action: "review", id: other.id, verdict: "rejected" }))
    .status,
  200,
);
assert.equal(
  (await call(admin)).body.paused,
  true,
  "other claim still pending",
);
assert.equal(
  (await call(admin, { action: "review", id: claim.id, verdict: "confirmed" }))
    .status,
  200,
);
assert.equal((await call("p")).body.claims[0].name, claim.name);
assert.equal(
  (await call(admin, { action: "draw" })).status,
  400,
  "confirmed winner ends round",
);
await call(admin, { action: "shuffle" });
game = (await call(admin)).body;
assert.equal(game.drawn.length, 0);
assert.equal(game.claims.length, 0);
assert.equal(game.players.length, 2);
assert.equal(game.round, 2);
assert.equal(
  (await call("p", null, randomUUID().replaceAll("-", ""))).body.role,
  "guest",
  "room isolation",
);
assert.equal(
  (await fetch(`${origin}/api/deck`, { method: "PUT" })).status,
  410,
);
assert.equal(
  (
    await fetch(`${origin}/api/rooms/${room}`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    })
  ).status,
  403,
);
console.log(
  "PASS: concurrent admin, permissions, registration, privacy, winner detection, VAR, reset, room isolation, legacy endpoint and CSRF.",
);
