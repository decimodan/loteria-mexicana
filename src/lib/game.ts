import cards from "./cards.json";
export type Player = { id: string; name: string; boards: string[][] };
export type Claim = {
  id: string;
  playerId: string;
  name: string;
  board: number;
  cards: string[];
  drawn: string[];
  status: "pending" | "confirmed" | "rejected";
};
export type Game = {
  admin: string | null;
  deck: string[];
  idx: number;
  round: number;
  players: Player[];
  claims: Claim[];
};
export function shuffled() {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
export function newGame(): Game {
  return {
    admin: null,
    deck: shuffled(),
    idx: 0,
    round: 1,
    players: [],
    claims: [],
  };
}
export function detect(game: Game) {
  const drawn = game.deck.slice(0, game.idx);
  for (const p of game.players)
    p.boards.forEach((board, index) => {
      if (
        board.every((c) => drawn.includes(c)) &&
        !game.claims.some((c) => c.playerId === p.id && c.board === index)
      )
        game.claims.push({
          id: crypto.randomUUID(),
          playerId: p.id,
          name: p.name,
          board: index,
          cards: [...board],
          drawn: [...drawn],
          status: "pending",
        });
    });
}
export function view(game: Game, id: string) {
  const admin = game.admin === id;
  return {
    role: admin
      ? "admin"
      : game.players.some((p) => p.id === id)
        ? "player"
        : "guest",
    adminTaken: !!game.admin,
    drawn: game.deck.slice(0, game.idx),
    total: game.deck.length,
    round: game.round,
    paused: game.claims.some((c) => c.status === "pending"),
    finished: game.claims.some((c) => c.status === "confirmed"),
    players: admin ? game.players : game.players.filter((p) => p.id === id),
    playerCount: game.players.length,
    claims: admin
      ? game.claims
      : game.claims
          .filter((c) => c.status === "confirmed")
          .map((c) => ({ name: c.name, board: c.board, status: c.status })),
  };
}
export function act(game: Game, id: string, data: any) {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (data.action === "admin") {
    if (game.admin && game.admin !== id)
      fail("Ya hay un administrador en esta sala.");
    if (game.players.some((p) => p.id === id))
      fail("Ya estás registrado como jugador.");
    game.admin = id;
    return;
  }
  if (data.action === "register") {
    if (game.admin === id)
      fail("El administrador no puede registrarse como jugador.");
    if (game.idx) fail("La ronda comenzó: los cartones están bloqueados.");
    if (
      typeof data.name !== "string" ||
      !data.name.trim() ||
      data.name.trim().length > 40
    )
      fail("Escribe un nombre de hasta 40 caracteres.");
    if (
      !Array.isArray(data.boards) ||
      data.boards.length < 1 ||
      data.boards.length > 2 ||
      data.boards.some(
        (b: any) =>
          !Array.isArray(b) ||
          b.length !== 16 ||
          new Set(b).size !== 16 ||
          b.some((c: any) => !cards.includes(c)),
      )
    )
      fail("Cada cartón debe tener 16 cartas diferentes.");
    if (game.players.length >= 100 && !game.players.some((p) => p.id === id))
      fail("La sala está llena.");
    game.players = game.players.filter((p) => p.id !== id);
    game.players.push({ id, name: data.name.trim(), boards: data.boards });
    return;
  }
  if (game.admin !== id)
    fail("Solo el administrador puede controlar la baraja y el VAR.");
  if (data.action === "shuffle") {
    game.deck = shuffled();
    game.idx = 0;
    game.round++;
    game.claims = [];
    return;
  }
  if (data.action === "draw") {
    if (game.claims.some((c) => c.status !== "rejected"))
      fail("Resuelve el VAR o inicia una nueva ronda.");
    if (!game.players.length)
      fail("Espera a que se registre al menos un jugador.");
    if (game.idx >= game.deck.length) fail("La baraja terminó.");
    game.idx++;
    detect(game);
    return;
  }
  if (data.action === "review") {
    const claim = game.claims.find((c) => c.id === data.id);
    if (
      !claim ||
      claim.status !== "pending" ||
      !["confirmed", "rejected"].includes(data.verdict)
    )
      fail("Revisión inválida.");
    claim!.status = data.verdict;
    return;
  }
  fail("Acción inválida.");
}
