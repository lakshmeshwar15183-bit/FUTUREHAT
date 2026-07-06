// FUTUREHAT mobile — flatten text/sticker overlays onto the base image (Phase B),
// producing a single PNG URI with everything baked in, so the sent photo carries the
// edits. Uses an offscreen Skia surface. Emoji/sticker-image/text are drawn at the
// overlay transforms mapped from stage space to source-pixel space.
//
// Native: @shopify/react-native-skia + expo-file-system. Runs on device only; this
// is code-complete and typechecks. Font metrics / emoji glyph rendering are best
// verified on a real device build (Skia can't run under tsc/JS).
import * as FileSystem from 'expo-file-system';
import { Skia, ImageFormat, type SkImage } from '@shopify/react-native-skia';
import type { Overlay, TextOverlay, StickerOverlay } from './overlays';

async function loadSkImage(uri: string): Promise<SkImage | null> {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const data = Skia.Data.fromBase64(b64);
    return Skia.Image.MakeImageFromEncoded(data);
  } catch {
    return null;
  }
}

/**
 * Composite `overlays` (positioned in stage px) over the base image (source px).
 * Returns a new file:// URI, or the original uri on any failure (never throws).
 */
export async function flattenOverlays(
  baseUri: string,
  overlays: Overlay[],
  stageW: number,
  stageH: number,
  srcW: number,
  srcH: number,
): Promise<string> {
  if (!overlays.length) return baseUri;
  try {
    const base = await loadSkImage(baseUri);
    if (!base) return baseUri;

    const surface = Skia.Surface.MakeOffscreen(srcW, srcH);
    if (!surface) return baseUri;
    const canvas = surface.getCanvas();

    // draw base
    const paint = Skia.Paint();
    canvas.drawImageRect(
      base,
      Skia.XYWHRect(0, 0, base.width(), base.height()),
      Skia.XYWHRect(0, 0, srcW, srcH),
      paint,
    );

    // stage→source scale (the stage shows the image "contain")
    const fit = Math.min(stageW / srcW, stageH / srcH);
    const shownW = srcW * fit, shownH = srcH * fit;
    const padX = (stageW - shownW) / 2, padY = (stageH - shownH) / 2;
    const toSrc = (sx: number, sy: number) => ({ x: (sx - padX) / fit, y: (sy - padY) / fit });
    const sScale = 1 / fit;

    for (const o of overlays) {
      const c = toSrc(o.x, o.y);
      canvas.save();
      canvas.translate(c.x, c.y);
      canvas.rotate((o.rotation * 180) / Math.PI, 0, 0);
      canvas.scale(o.scale * sScale, o.scale * sScale);

      if (o.kind === 'sticker') {
        const s = o as StickerOverlay;
        if (!s.isEmoji) {
          const img = await loadSkImage(s.content);
          if (img) {
            const w = 90, h = 90;
            canvas.drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(-w / 2, -h / 2, w, h), paint);
          }
        } else {
          drawGlyph(canvas, s.content, 60);
        }
      } else {
        const t = o as TextOverlay;
        drawText(canvas, t);
      }
      canvas.restore();
    }

    const snap = surface.makeImageSnapshot();
    const outB64 = snap.encodeToBase64(ImageFormat.PNG, 100);
    const out = `${FileSystem.cacheDirectory}fh_edit_${Date.now()}.png`;
    await FileSystem.writeAsStringAsync(out, outB64, { encoding: FileSystem.EncodingType.Base64 });
    return out;
  } catch {
    return baseUri;
  }
}

function drawGlyph(canvas: any, glyph: string, size: number) {
  const font = Skia.Font(undefined, size);
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#FFFFFF'));
  // center the glyph roughly around origin
  canvas.drawText(glyph, -size / 2, size / 3, paint, font);
}

function drawText(canvas: any, t: TextOverlay) {
  const size = 30;
  const font = Skia.Font(undefined, size);
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(t.color));
  const lines = t.text.split('\n');
  lines.forEach((line, i) => {
    // rough centering; precise metrics verified on-device
    const width = line.length * size * 0.5;
    const x = t.align === 'center' ? -width / 2 : t.align === 'right' ? -width : 0;
    canvas.drawText(line, x, i * (size * 1.2), paint, font);
  });
}
