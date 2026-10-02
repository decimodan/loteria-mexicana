import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import {
  mergePrintedBoard,
  generateBoards,
  encodeBoard,
  decodeBoard,
  boardLink,
  boardCode,
  tokenFromInput,
  roomFromInvite,
} from "../src/lib/printable-boards.ts";
import { createBoardsPdf, loadPrintImage } from "../src/lib/boards-pdf.ts";
const boards = generateBoards(100);
assert.deepEqual(mergePrintedBoard([[]], boards[0].token), [boards[0].cards]);
assert.deepEqual(mergePrintedBoard([boards[0].cards], boards[1].token), [
  boards[0].cards,
  boards[1].cards,
]);
assert.deepEqual(mergePrintedBoard([boards[0].cards, []], boards[1].token), [
  boards[0].cards,
  boards[1].cards,
]);
assert.throws(() => mergePrintedBoard([boards[0].cards], boards[0].token));
assert.throws(() =>
  mergePrintedBoard([boards[0].cards, boards[1].cards], boards[2].token),
);
assert.equal(boards.length, 100);
assert.equal(
  new Set(boards.map((b) => [...b.cards].sort().join("|"))).size,
  100,
);
for (const board of boards) {
  assert.equal(board.cards.length, 16);
  assert.equal(new Set(board.cards).size, 16);
  assert.deepEqual(decodeBoard(board.token), board.cards);
  assert.equal(boardCode(board.token), board.code);
}
for (const count of [0, -1, 101, 1.5, NaN, Infinity])
  assert.throws(() => generateBoards(count));
for (const token of [
  "v2." + "00".repeat(16),
  "v1." + "zz".repeat(16),
  "v1." + "00".repeat(16),
  "v1.abc",
  "<script>",
])
  assert.throws(() => decodeBoard(token));
assert.throws(() => encodeBoard(boards[0].cards.slice(0, 15)));
const origin = "https://loteria.example";
const room = "a".repeat(32);
const url = boardLink(boards[0].token, origin, room);
assert.equal(new URL(url).searchParams.get("sala"), room);
assert.equal(tokenFromInput(url, origin, room), boards[0].token);
assert.equal(new URL(boardLink(boards[0].token, origin)).pathname, "/cartones");
assert.equal(roomFromInvite(url, origin), room);
assert.throws(() => roomFromInvite(url, "https://evil.example"));
assert.throws(() => tokenFromInput(url, origin, "b".repeat(32)));
assert.throws(() => tokenFromInput(url, "https://evil.example", room));
assert.throws(() => boardLink(boards[0].token, origin, "invalid"));
// Exercise both image formats and a realistic long room QR. Only one load per card.
const catalog = JSON.parse(
  await readFile(new URL("../src/lib/cards.json", import.meta.url)),
);
const fixture = [
  ...catalog.filter((c) => c.endsWith(".png")),
  ...catalog.filter((c) => c.endsWith(".jpg")),
].slice(0, 16);
const first = {
  cards: fixture,
  token: encodeBoard(fixture),
  code: boardCode(encodeBoard(fixture)),
};
const second = boards[1];
let loaded = 0,
  progress = 0;
const bytes = await createBoardsPdf(
  [first, second],
  origin,
  room,
  async (filename) => {
    loaded++;
    return new Uint8Array(
      await readFile(
        process.env.PDF_QA_IMAGE_DIR
          ? `${process.env.PDF_QA_IMAGE_DIR}/${filename}`
          : new URL(`../public/cartas-sin-borde/${filename}`, import.meta.url),
      ),
    );
  },
  (done) => {
    progress = done;
  },
);
const doc = await PDFDocument.load(bytes);
assert.equal(doc.getPageCount(), 2);
assert.deepEqual(doc.getPage(0).getSize(), { width: 612, height: 792 });
assert.equal(progress, 2);
assert.equal(loaded, new Set([...first.cards, ...second.cards]).size);
if (process.env.PDF_QA_OUTPUT) {
  await mkdir("tmp/pdfs", { recursive: true });
  await writeFile(process.env.PDF_QA_OUTPUT, bytes);
  await writeFile(
    "tmp/pdfs/expected-qr.json",
    JSON.stringify([
      boardLink(first.token, origin, room),
      boardLink(second.token, origin, room),
    ]),
  );
}
await assert.rejects(() =>
  createBoardsPdf([first], origin, room, async () => {
    throw new Error("test image failure");
  }),
);
console.log(
  "PASS: 100 unique boards, QR round-trip/order, invalid input, room targeting, reusable links, PDF pages/images/cache/progress and load failures.",
);

await assert.rejects(() => createBoardsPdf([], origin, room));
await assert.rejects(() =>
  createBoardsPdf([{ ...first, cards: second.cards }], origin, room),
);

// Browser image adapter: verify print dimensions, format, cleanup and retry errors.
const originalFetch = globalThis.fetch;
const originalBitmap = globalThis.createImageBitmap;
const originalDocument = globalThis.document;
const jpegBytes = await readFile(
  new URL("../public/cartas-sin-borde/1-EL-GALLO.jpg", import.meta.url),
);
let closed = 0,
  canvas;
try {
  globalThis.fetch = async () => new Response(jpegBytes);
  globalThis.createImageBitmap = undefined;
  assert.deepEqual(
    await loadPrintImage("1-EL-GALLO.jpg"),
    new Uint8Array(jpegBytes),
  );
  globalThis.createImageBitmap = async () => ({
    width: 1200,
    height: 1800,
    close() {
      closed++;
    },
  });
  globalThis.document = {
    createElement() {
      canvas = {
        width: 0,
        height: 0,
        getContext() {
          return { fillRect() {}, drawImage() {} };
        },
        toBlob(cb, type, quality) {
          assert.equal(type, "image/jpeg");
          assert.equal(quality, 0.92);
          cb(new Blob([jpegBytes]));
        },
      };
      return canvas;
    },
  };
  assert.deepEqual(
    await loadPrintImage("1-EL-GALLO.jpg"),
    new Uint8Array(jpegBytes),
  );
  assert.equal(canvas.width, 400);
  assert.equal(canvas.height, 600);
  assert.equal(closed, 1);
  globalThis.document = {
    createElement() {
      return {
        getContext() {
          return null;
        },
      };
    },
  };
  await assert.rejects(() => loadPrintImage("1-EL-GALLO.jpg"));
  assert.equal(closed, 2);
  globalThis.fetch = async () => new Response("", { status: 404 });
  await assert.rejects(() => loadPrintImage("missing.jpg"));
} finally {
  globalThis.fetch = originalFetch;
  globalThis.createImageBitmap = originalBitmap;
  globalThis.document = originalDocument;
}
console.log(
  "PASS: browser image optimization size, JPEG format, fallback, cleanup and fetch/canvas failures.",
);
