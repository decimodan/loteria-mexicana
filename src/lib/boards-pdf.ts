import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import QRCode from "qrcode";
import {
  boardLink,
  decodeBoard,
  MAX_PRINT_BOARDS,
  type PrintedBoard,
} from "./printable-boards.ts";

// Borderless Letter page: compact single-row header; grid runs to all page edges.
export const BOARD_PDF_LAYOUT = {
  pageWidth: 612,
  pageHeight: 792,
  margin: 0,
  gridTop: 64,
  qrSize: 60,
  qrTop: 2,
} as const;

// 800px preserves print detail on the enlarged full-page cards; reuse assets per PDF.
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
    const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
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
  pdf.setTitle("Cartones físicos de Loteria Mexa");
  pdf.setCreator("Loteria Mexa");
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const images = new Map<string, PDFImage>();
  const navy = rgb(0.35, 0.09, 0.1);
  for (const [index, board] of boards.entries()) {
    // US Letter, one board per page. Coordinates here are from the top.
    const page = pdf.addPage([
      BOARD_PDF_LAYOUT.pageWidth,
      BOARD_PDF_LAYOUT.pageHeight,
    ]);
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
    const number = board.number ?? index + 1;
    text("LOTERIA MEXA", 12, 20, 22, true);
    text(`CARTÓN ${number}`, 246, 25, 14, true);
    const left = BOARD_PDF_LAYOUT.margin,
      top = BOARD_PDF_LAYOUT.gridTop,
      cellW = (BOARD_PDF_LAYOUT.pageWidth - left * 2) / 4,
      cellH = (BOARD_PDF_LAYOUT.pageHeight - top - BOARD_PDF_LAYOUT.margin) / 4;
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
      // Full artwork, edge-to-edge: no crop of card names/numbers and no letterboxing.
      page.drawImage(image, {
        x,
        y: 792 - y - cellH,
        width: cellW,
        height: cellH,
      });
    }
    const url = boardLink(board.token, origin, room, number);
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const quiet = 4,
      qrSize = BOARD_PDF_LAYOUT.qrSize,
      unit = qrSize / (qr.modules.size + quiet * 2);
    const qrX = BOARD_PDF_LAYOUT.pageWidth - qrSize - 2,
      qrTop = BOARD_PDF_LAYOUT.qrTop;
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
    progress(index + 1, boards.length);
  }
  return pdf.save();
}
