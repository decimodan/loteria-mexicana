import {
  boardLink,
  decodeBoard,
  parseBoardNumber,
  validRoom,
  tokenFromInput,
  numberFromInput,
  type PrintedBoard,
} from "./printable-boards.ts";
export type StoredBoard = {
  token: string;
  number: number;
  room: string | null;
};
export function validateStoredBoard(value: any): StoredBoard {
  if (!value || typeof value.token !== "string")
    throw new Error("Cartón inválido.");
  decodeBoard(value.token);
  const number = parseBoardNumber(String(value.number));
  if (!number || (value.room !== null && !validRoom(value.room)))
    throw new Error("Cartón o sala inválidos.");
  return { token: value.token, number, room: value.room };
}
export async function shortBoardId(record: StoredBoard) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(record)),
    ),
  );
  return btoa(String.fromCharCode(...digest.slice(0, 9)))
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}
export function isShortId(id: string) {
  return /^[A-Za-z0-9_-]{12}$/.test(id);
}
export async function saveShortBoards(
  boards: PrintedBoard[],
  origin: string,
  room: string | null,
): Promise<string[]> {
  const response = await fetch("/api/printed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      boards: boards.map((b, i) => ({
        token: b.token,
        number: b.number ?? i + 1,
        room,
      })),
    }),
  });
  const result = (await response.json()) as { error?: string; ids?: string[] };
  if (!response.ok)
    throw new Error(
      result.error ?? "No se pudieron guardar los cartones. Intenta de nuevo.",
    );
  if (
    !Array.isArray(result.ids) ||
    result.ids.length !== boards.length ||
    result.ids.some((id) => !isShortId(id))
  )
    throw new Error("Respuesta de cartones inválida.");
  return result.ids.map((id) => new URL(`/c/${id}`, origin).href);
}
export async function resolveBoardInput(
  input: string,
  origin: string,
  room: string,
) {
  input = input.trim();
  let url: URL | null = null;
  try {
    url = new URL(input);
  } catch {}
  if (url?.origin === origin && url.pathname.startsWith("/c/")) {
    const id = url.pathname.slice(3);
    if (!isShortId(id)) throw new Error("Enlace de cartón inválido.");
    const response = await fetch(`/api/printed/${id}`, { cache: "no-store" });
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? "No se encontró este cartón."
          : "No se pudo recuperar el cartón. Intenta de nuevo.",
      );
    const record = validateStoredBoard(await response.json());
    const expanded = boardLink(
      record.token,
      origin,
      record.room,
      record.number,
    );
    return {
      token: tokenFromInput(expanded, origin, room),
      number: record.number,
    };
  }
  return {
    token: tokenFromInput(input, origin, room),
    number: numberFromInput(input),
  };
}
