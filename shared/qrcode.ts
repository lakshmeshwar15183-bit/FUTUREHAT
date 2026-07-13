// Lumixo — QR matrix via `qrcode` (create API, no canvas required).
// Works in web + React Native: callers render boolean[][] as SVG / Views.

import QRCode from 'qrcode';

/**
 * Encode text as a QR module matrix (true = dark).
 * Returns null if encoding fails.
 */
export function qrMatrix(text: string): boolean[][] | null {
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const data = qr.modules.data;
    const matrix: boolean[][] = [];
    for (let y = 0; y < size; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < size; x++) {
        // data may be Uint8Array or boolean[][] depending on qrcode version
        const cell = (data as any)[y * size + x] ?? (data as any)[y]?.[x];
        row.push(!!cell);
      }
      matrix.push(row);
    }
    return matrix;
  } catch {
    return null;
  }
}

export function qrMatrixForUrl(url: string): boolean[][] | null {
  if (!url?.trim()) return null;
  return qrMatrix(url.trim());
}
