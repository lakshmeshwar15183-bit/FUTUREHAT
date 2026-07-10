// Lumixo mobile — shared overlay model for the media editor (Phase B). Text and
// sticker layers are positioned/scaled/rotated on top of the image and flattened
// into the final URI when the user sends. Kept framework-agnostic so both the
// TextTool and StickerTool produce the same shape and the preview can render them.

export type OverlayKind = 'text' | 'sticker';

export interface BaseOverlay {
  id: string;
  kind: OverlayKind;
  x: number;          // center, in stage px
  y: number;
  scale: number;
  rotation: number;   // radians
  opacity: number;
}

export interface TextOverlay extends BaseOverlay {
  kind: 'text';
  text: string;
  color: string;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  background: 'none' | 'solid' | 'translucent';
}

export interface StickerOverlay extends BaseOverlay {
  kind: 'sticker';
  /** emoji glyph OR a data-URI sticker image. */
  content: string;
  isEmoji: boolean;
}

export type Overlay = TextOverlay | StickerOverlay;

let counter = 0;
export function overlayId(): string {
  counter += 1;
  return `ovl_${counter}_${Math.round(counter * 2654435761 % 100000)}`;
}
