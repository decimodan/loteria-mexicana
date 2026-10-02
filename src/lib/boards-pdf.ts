import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import QRCode from "qrcode";
import {
  boardLink,
  decodeBoard,
  MAX_PRINT_BOARDS,
  type PrintedBoard,
} from "./printable-boards.ts";

// 600px is enough for >300dpi at the printed card height; reuse assets per PDF.
export async function loadPrintImage(filename: string): Promise<Uint8Array> {
  const response = await fetch(
    `/cartas-sin-borde/${encodeURIComponent(filename)}`,
  );
  if (!response.ok)
    throw new Error("No se pudo cargar una carta. Intenta descargar de nuevo.");
  const blob = await response.blob();
  if (typeof createImageBitmap !== "function")
    return new Uint8Array(await blob.arrayBuffer());
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("No fue posible preparar las imágenes para impresión.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("No fue posible preparar una carta.")),
        "image/jpeg",
        0.92,
      ),
    );
    return new Uint8Array(await jpeg.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

export async function createBoardsPdf(
  boards: PrintedBoard[],
  origin: string,
  room: string | null,
  loadImage: (filename: string) => Promise<Uint8Array> = loadPrintImage,
  progress: (completed: number, total: number) => void = () => {},
) {
  if (!boards.length || boards.length > MAX_PRINT_BOARDS)
    throw new Error("El PDF requiere entre 1 y 100 cartones.");
  for (const board of boards) {
    if (decodeBoard(board.token).join("|") !== board.cards.join("|"))
      throw new Error("Las cartas del QR no coinciden con el cartón.");
  }
  const pdf = await PDFDocument.create();
  pdf.setTitle("Cartones físicos de Lotería Mexicana");
  pdf.setCreator("Lotería Mexicana");
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const images = new Map<string, PDFImage>();
  const navy = rgb(0.06, 0.13, 0.21);
  for (const [index, board] of boards.entries()) {
    // US Letter, one board per page. Coordinates here are from the top.
    const page = pdf.addPage([612, 792]);
    const text = (
      value: string,
      x: number,
      top: number,
      size: number,
      strong = false,
    ) =>
      page.drawText(value, {
        x,
        y: 792 - top - size,
        size,
        font: strong ? bold : regular,
        color: navy,
      });
    text("LOTERÍA MEXICANA", 54, 28, 22, true);
    text(
      `Cartón ${String(index + 1).padStart(3, "0")}  /  ${boards.length}`,
      54,
      58,
      11,
    );
    text(board.code, 430, 58, 11, true);
    const left = 54,
      top = 84,
      cellW = 126,
      cellH = 132;
    for (const [slot, filename] of board.cards.entries()) {
      if (!images.has(filename)) {
        const bytes = await loadImage(filename);
        images.set(
          filename,
          bytes[0] === 0x89 && bytes[1] === 0x50
            ? await pdf.embedPng(bytes)
            : await pdf.embedJpg(bytes),
        );
      }
      const image = images.get(filename)!;
      const x = left + (slot % 4) * cellW;
      const y = top + Math.floor(slot / 4) * cellH;
      const scale = Math.min(
        (cellW - 8) / image.width,
        (cellH - 8) / image.height,
      );
      const width = image.width * scale,
        height = image.height * scale;
      page.drawImage(image, {
        x: x + (cellW - width) / 2,
        y: 792 - y - (cellH + height) / 2,
        width,
        height,
      });
      page.drawRectangle({
        x,
        y: 792 - y - cellH,
        width: cellW,
        height: cellH,
        borderColor: rgb(0.75, 0.78, 0.81),
        borderWidth: 0.6,
      });
    }
    const url = boardLink(board.token, origin, room);
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const quiet = 4,
      qrSize = 96,
      unit = qrSize / (qr.modules.size + quiet * 2);
    const qrX = 54,
      qrTop = 636;
    for (let row = 0; row < qr.modules.size; row++)
      for (let col = 0; col < qr.modules.size; col++) {
        if (qr.modules.get(row, col))
          page.drawRectangle({
            x: qrX + (col + quiet) * unit,
            y: 792 - qrTop - (row + quiet + 1) * unit,
            width: unit,
            height: unit,
            color: rgb(0, 0, 0),
          });
      }
    text("Escanea para registrar este cartón en el VAR", 164, 643, 13, true);
    text(
      room
        ? "1. Escanea el QR.  2. Escribe tu nombre.  3. Guarda tu cartón."
        : "1. Escanea el QR.  2. Pega el enlace de la sala.",
      164,
      668,
      10,
    );
    text(
      room
        ? "Registro disponible antes de la primera carta de la ronda."
        : "3. Escribe tu nombre y guarda tu cartón antes de iniciar.",
      164,
      687,
      10,
    );
    text(
      "Regla: cartón lleno (16 cartas). El administrador revisa el VAR.",
      164,
      708,
      9,
    );
    text(
      `Imprimir en papel Carta al 100%  |  ${index + 1} / ${boards.length}`,
      54,
      754,
      9,
    );
    progress(index + 1, boards.length);
  }
  return pdf.save();
}
