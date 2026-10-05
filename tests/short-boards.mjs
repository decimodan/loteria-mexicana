import assert from "node:assert/strict";
import { generateBoards, boardLink } from "../src/lib/printable-boards.ts";
import {
  validateStoredBoard,
  shortBoardId,
  resolveBoardInput,
} from "../src/lib/short-boards.ts";
import QRCode from "qrcode";
const origin = process.env.TEST_ORIGIN ?? "http://localhost:8788";
const boards = generateBoards(2);
const room = "a".repeat(32);
const records = boards.map((b, i) => ({
  token: b.token,
  number: b.number,
  room: i ? null : room,
}));
async function create(body, extra = {}) {
  return fetch(`${origin}/api/printed`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...extra },
    body: JSON.stringify(body),
  });
}
const r = await create({ boards: records });
assert.equal(r.status, 200);
const { ids } = await r.json();
assert.equal(ids.length, 2);
const again = await create({ boards: records });
assert.deepEqual((await again.json()).ids, ids, "stable retry links");
for (const [i, id] of ids.entries()) {
  assert.match(id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(await shortBoardId(validateStoredBoard(records[i])), id);
  const loaded = await fetch(`${origin}/api/printed/${id}`);
  assert.equal(loaded.status, 200);
  assert.deepEqual(await loaded.json(), records[i]);
  const redirect = await fetch(`${origin}/c/${id}`, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(
    redirect.headers.get("location"),
    boardLink(records[i].token, origin, records[i].room, records[i].number),
  );
  const followed = await fetch(`${origin}/c/${id}`);
  assert.equal(followed.status, 200);
  assert.ok(
    new URL(followed.url).searchParams.get("carton") === records[i].token,
  );
  const short = new URL(
    `/c/${id}`,
    "https://loteria-mexicana.example.workers.dev",
  ).href;
  const long = boardLink(
    records[i].token,
    "https://loteria-mexicana.example.workers.dev",
    records[i].room,
    records[i].number,
  );
  assert.ok(short.length < long.length);
  assert.ok(
    QRCode.create(short).modules.size < QRCode.create(long).modules.size,
    "fewer QR modules",
  );
}
assert.equal((await fetch(`${origin}/c/AAAAAAAAAAAA`)).status, 404);
assert.equal((await fetch(`${origin}/c/invalid`)).status, 404);
assert.equal(
  (await fetch(`${origin}/api/printed/${ids[0]}`, { method: "PUT" })).status,
  405,
);
assert.equal(
  (await create({ boards: records }, { origin: "https://evil.example" }))
    .status,
  403,
);
for (const body of [
  { boards: [] },
  { boards: Array(101).fill(records[0]) },
  { boards: [{ ...records[0], token: "bad" }] },
  { boards: [{ ...records[0], number: 0 }] },
  { boards: [{ ...records[0], room: "bad" }] },
])
  assert.equal((await create(body)).status, 400);
// Exercise manual paste resolver with a real API but relative URLs like browser fetch.
const original = globalThis.fetch;
globalThis.fetch = (input, opts) => original(new URL(input, origin), opts);
try {
  const resolved = await resolveBoardInput(
    `${origin}/c/${ids[0]}`,
    origin,
    room,
  );
  assert.deepEqual(resolved, { token: records[0].token, number: 1 });
  await assert.rejects(() =>
    resolveBoardInput(`${origin}/c/${ids[0]}`, origin, "b".repeat(32)),
  );
  assert.deepEqual(await resolveBoardInput(records[0].token, origin, room), {
    token: records[0].token,
    number: null,
  });
  await assert.rejects(() =>
    resolveBoardInput(`${origin}/c/AAAAAAAAAAAA`, origin, room),
  );
} finally {
  globalThis.fetch = original;
}
console.log(
  "PASS short boards: immutable retry IDs, stored exact cards/number/room, redirect/legacy registration, reusable cards, manual paste, lower QR density and invalid inputs/CSRF/methods.",
);
