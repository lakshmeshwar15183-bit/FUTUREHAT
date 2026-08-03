// Lumixo mobile — generate branded icon/splash/notification assets from brand-logo.png.
// Run: node scripts/generate-assets.mjs
import sharp from 'sharp';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(ROOT, 'assets');
const BRAND = resolve(ASSETS, 'brand-logo.png');
const WEB_PUBLIC = resolve(ROOT, '..', 'web', 'public');
const APP_ICONS = resolve(ASSETS, 'app-icons');

const BG = '#0A0A0A';
const SPLASH_BG = '#0B141A';

if (!existsSync(BRAND)) {
  console.error('Missing assets/brand-logo.png — place the master logo there first.');
  process.exit(1);
}

mkdirSync(ASSETS, { recursive: true });

async function solidIcon(size) {
  // Full-bleed square icon: logo covers the canvas (black bg already in source).
  return sharp(BRAND)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
}

async function adaptiveForeground(size) {
  // Full-bleed brand mark on transparent. Adaptive system masks crop ~18%;
  // source already has ~8% margins so the L stays inside the safe zone.
  // Black adaptive backgroundColor fills any remaining edge.
  return sharp(BRAND)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .png()
    .toBuffer();
}

async function splash(size) {
  const mark = Math.round(size * 0.55);
  const logo = await sharp(BRAND)
    .resize(mark, mark, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: SPLASH_BG,
    },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/** Android notification: white silhouette on transparent. */
async function monoNotification(size) {
  const { data, info } = await sharp(BRAND)
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Bright gold mark → white; near-black bg → transparent.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const alpha = lum > 28 ? Math.min(255, Math.round((lum - 20) * 1.4)) : 0;
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = alpha;
  }

  // Slight inset so the glyph sits cleanly in the status bar.
  const inset = Math.round(size * 0.08);
  const glyph = await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .resize(size - inset * 2, size - inset * 2)
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: glyph, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function writePng(buf, path) {
  await sharp(buf).png().toFile(path);
  console.log('wrote', path.replace(ROOT + '/', '').replace(WEB_PUBLIC + '/', 'web/public/'));
}

async function writeWebp(buf, path, size) {
  await sharp(buf).resize(size, size).webp({ quality: 92 }).toFile(path);
}

// ── Core Expo assets ──────────────────────────────────────────────
const icon1024 = await solidIcon(1024);
const adaptive1024 = await adaptiveForeground(1024);
const splash1024 = await splash(1024);
const notif96 = await monoNotification(96);
const fav48 = await solidIcon(48);

await writePng(icon1024, resolve(ASSETS, 'icon.png'));
await writePng(adaptive1024, resolve(ASSETS, 'adaptive-icon.png'));
await writePng(splash1024, resolve(ASSETS, 'splash.png'));
await writePng(notif96, resolve(ASSETS, 'notification-icon.png'));
await writePng(fav48, resolve(ASSETS, 'favicon.png'));

// ── Web public assets ─────────────────────────────────────────────
if (existsSync(WEB_PUBLIC)) {
  await writePng(icon1024, resolve(WEB_PUBLIC, 'lumixo.png'));
  await writePng(await solidIcon(512), resolve(WEB_PUBLIC, 'lumixo-512.png'));
  await writePng(await solidIcon(192), resolve(WEB_PUBLIC, 'lumixo-192.png'));
  await writePng(await solidIcon(32), resolve(WEB_PUBLIC, 'favicon.png'));

  // SVG wrapper embedding the PNG for crisp PWA / tab icons where SVG is preferred.
  const png512 = readFileSync(resolve(WEB_PUBLIC, 'lumixo-512.png'));
  const b64 = png512.toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Lumixo">
  <image href="data:image/png;base64,${b64}" width="512" height="512" preserveAspectRatio="xMidYMid meet"/>
</svg>
`;
  writeFileSync(resolve(WEB_PUBLIC, 'lumixo.svg'), svg);
  console.log('wrote web/public/lumixo.svg');
}

// ── Default alternate launcher icon (icon1) ───────────────────────
// icon2–6 stay as alternate themes; icon1 is the default brand.
const solid = await solidIcon(1024);
const preview = await solidIcon(180);
const master = await adaptiveForeground(1024); // transparent-padded master

await writePng(master, resolve(APP_ICONS, 'icon1_master.png'));
await writePng(solid, resolve(APP_ICONS, 'icon1_solid.png'));
await writePng(preview, resolve(APP_ICONS, 'icon1_preview_solid.png'));
// Preview with slight transparency edge for the picker tile
await writePng(await adaptiveForeground(180), resolve(APP_ICONS, 'icon1_preview.png'));

// Android density packs for icon1
const densities = {
  mdpi: { launcher: 48, foreground: 108 },
  hdpi: { launcher: 72, foreground: 162 },
  xhdpi: { launcher: 96, foreground: 216 },
  xxhdpi: { launcher: 144, foreground: 324 },
  xxxhdpi: { launcher: 192, foreground: 432 },
};

for (const [dens, sizes] of Object.entries(densities)) {
  const dir = resolve(APP_ICONS, 'android-res', `mipmap-${dens}`);
  mkdirSync(dir, { recursive: true });
  const launcher = await solidIcon(sizes.launcher);
  const fg = await adaptiveForeground(sizes.foreground);
  await writeWebp(launcher, resolve(dir, 'ic_launcher_icon1.webp'), sizes.launcher);
  await writeWebp(launcher, resolve(dir, 'ic_launcher_icon1_round.webp'), sizes.launcher);
  await writeWebp(fg, resolve(dir, 'ic_launcher_icon1_foreground.webp'), sizes.foreground);
  console.log('wrote app-icons/android-res/mipmap-' + dens + '/ic_launcher_icon1*');
}

// iOS app icon set for icon1
const iosDir = resolve(APP_ICONS, 'ios', 'AppIcon-icon1.appiconset');
mkdirSync(iosDir, { recursive: true });
const iosSizes = [
  'icon_20x20@1x.png:20',
  'icon_20x20@2x.png:40',
  'icon_20x20@3x.png:60',
  'icon_29x29@1x.png:29',
  'icon_29x29@2x.png:58',
  'icon_29x29@3x.png:87',
  'icon_40x40@1x.png:40',
  'icon_40x40@2x.png:80',
  'icon_40x40@3x.png:120',
  'icon_60x60@2x.png:120',
  'icon_60x60@3x.png:180',
  'icon_76x76@1x.png:76',
  'icon_76x76@2x.png:152',
  'icon_83.5x83.5@2x.png:167',
  'icon-1024.png:1024',
];
for (const entry of iosSizes) {
  const [name, sizeStr] = entry.split(':');
  const size = Number(sizeStr);
  await writePng(await solidIcon(size), resolve(iosDir, name));
}

// ── Live Android project res (so current build picks up the logo) ──
const androidRes = resolve(ROOT, 'android', 'app', 'src', 'main', 'res');
if (existsSync(androidRes)) {
  for (const [dens, sizes] of Object.entries(densities)) {
    const dir = resolve(androidRes, `mipmap-${dens}`);
    if (!existsSync(dir)) continue;
    const launcher = await solidIcon(sizes.launcher);
    const fg = await adaptiveForeground(sizes.foreground);
    // Default Expo launcher
    await writeWebp(launcher, resolve(dir, 'ic_launcher.webp'), sizes.launcher);
    await writeWebp(launcher, resolve(dir, 'ic_launcher_round.webp'), sizes.launcher);
    await writeWebp(fg, resolve(dir, 'ic_launcher_foreground.webp'), sizes.foreground);
    // Alternate icon1
    await writeWebp(launcher, resolve(dir, 'ic_launcher_icon1.webp'), sizes.launcher);
    await writeWebp(launcher, resolve(dir, 'ic_launcher_icon1_round.webp'), sizes.launcher);
    await writeWebp(fg, resolve(dir, 'ic_launcher_icon1_foreground.webp'), sizes.foreground);
  }
  // Adaptive background color for dark brand mark
  const colorsPath = resolve(androidRes, 'values', 'colors.xml');
  if (existsSync(colorsPath)) {
    let xml = readFileSync(colorsPath, 'utf8');
    xml = xml.replace(
      /<color name="iconBackground">[^<]*<\/color>/,
      `<color name="iconBackground">${BG}</color>`,
    );
    writeFileSync(colorsPath, xml);
    console.log('updated android iconBackground →', BG);
  }
  console.log('updated live android/app/src/main/res mipmaps');
}

console.log('done — brand logo applied');
