import catalog from "./print-card-catalog-v1.json" with { type: "json" };
import cards from "./cards.json" with { type: "json" };

// Never reorder v1: QR indexes on printed paper must remain valid across releases.
export const MAX_PRINT_BOARDS = 100;
export type PrintedBoard = {
  cards: string[];
  token: string;
  code: string;
  number?: number;
};
export function encodeBoard(board: string[]): string {
  if (board.length !== 16 || new Set(board).size !== 16)
    throw new Error("El cartón debe contener 16 cartas diferentes.");
  const indexes = board.map((c) => catalog.indexOf(c));
  if (indexes.some((i) => i < 0))
    throw new Error("Carta no disponible para impresión.");
  return `v1.${indexes.map((i) => i.toString(36).padStart(2, "0")).join("")}`;
}
export function decodeBoard(token: string): string[] {
  if (!/^v1\.[0-9a-z]{32}$/.test(token))
    throw new Error(
      "El QR del cartón no es válido o su versión no es compatible.",
    );
  const indexes = token
    .slice(3)
    .match(/.{2}/g)!
    .map((s) => parseInt(s, 36));
  if (new Set(indexes).size !== 16 || indexes.some((i) => i >= catalog.length))
    throw new Error("El QR debe contener 16 cartas válidas diferentes.");
  const board = indexes.map((i) => catalog[i]);
  if (board.some((c) => !cards.includes(c)))
    throw new Error("Este cartón contiene cartas que ya no están disponibles.");
  return board;
}
export function boardCode(token: string): string {
  let hash = 2166136261;
  for (const c of token) {
    hash ^= c.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `C-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}
function randomIndex(max: number) {
  const limit = 0x100000000 - (0x100000000 % max);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % max;
}
export function generateBoards(count: number): PrintedBoard[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PRINT_BOARDS)
    throw new Error(`Elige entre 1 y ${MAX_PRINT_BOARDS} cartones.`);
  const seen = new Set<string>();
  const result: PrintedBoard[] = [];
  const available = catalog.filter((c) => cards.includes(c));
  if (available.length < 16)
    throw new Error("No hay suficientes cartas para generar cartones.");
  let attempts = 0;
  while (result.length < count) {
    if (++attempts > count * 100)
      throw new Error(
        "No fue posible generar suficientes cartones diferentes.",
      );
    const deck = [...available];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const board = deck.slice(0, 16);
    const key = [...board].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const token = encodeBoard(board);
    result.push({
      cards: board,
      token,
      code: boardCode(token),
      number: result.length + 1,
    });
  }
  return result;
}
export function validRoom(room: string | null): room is string {
  return !!room && /^[a-f0-9]{32}$/.test(room);
}
export function roomFromInvite(input: string, origin: string): string {
  if (validRoom(input.trim())) return input.trim();
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Pega el enlace de la sala o su código.");
  }
  if (url.origin !== origin || !validRoom(url.searchParams.get("sala")))
    throw new Error("Usa un enlace válido de una sala de este sitio.");
  return url.searchParams.get("sala")!;
}
export function boardLink(
  token: string,
  origin: string,
  room?: string | null,
  number?: number | null,
): string {
  decodeBoard(token);
  if (room && !validRoom(room)) throw new Error("Sala inválida.");
  const url = new URL(room ? "/" : "/cartones", origin);
  if (room) url.searchParams.set("sala", room);
  url.searchParams.set("carton", token);
  if (number != null) {
    parseBoardNumber(String(number));
    url.searchParams.set("tabla", String(number));
  }
  return url.href;
}
export function tokenFromInput(
  input: string,
  origin: string,
  room: string,
): string {
  input = input.trim();
  if (input.startsWith("v1.")) {
    decodeBoard(input);
    return input;
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Pega el enlace o código del cartón.");
  }
  if (url.origin !== origin)
    throw new Error("El cartón debe pertenecer a este sitio.");
  const linkedRoom = url.searchParams.get("sala");
  if (linkedRoom && linkedRoom !== room)
    throw new Error(
      "Este QR pertenece a otra sala. Usa su enlace para entrar en ella.",
    );
  const token = url.searchParams.get("carton") ?? "";
  decodeBoard(token);
  return token;
}

export function mergePrintedBoard(
  existing: string[][],
  token: string,
): string[][] {
  const imported = decodeBoard(token);
  if (existing.some((b) => b.join("|") === imported.join("|")))
    throw new Error(
      "Este cartón ya está cargado. Puedes revisar tus cartones registrados.",
    );
  const result = existing.map((b) => [...b]);
  const empty = result.findIndex((b) => b.length === 0);
  if (empty >= 0) result[empty] = imported;
  else if (result.length < 2) result.push(imported);
  else
    throw new Error(
      "Ya tienes dos cartones. Edita tus cartones y quita uno antes de importar otro.",
    );
  return result;
}

export function parseBoardNumber(value: string | null): number | null {
  if (value === null) return null;
  if (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) > MAX_PRINT_BOARDS)
    throw new Error("Número de cartón inválido.");
  return Number(value);
}
export function numberFromInput(input: string): number | null {
  input = input.trim();
  if (input.startsWith("v1.")) return null;
  return parseBoardNumber(new URL(input).searchParams.get("tabla"));
}
