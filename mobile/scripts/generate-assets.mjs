// Lumixo mobile — generate original branded icon/splash/notification assets.
// Pure-vector mark (no copyrighted imagery): a teal gradient tile with a white
// speech bubble containing a bold "F". Run: node scripts/generate-assets.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(ASSETS, { recursive: true });

const TEAL = '#00A884';
const TEAL_DARK = '#007A63';

// A speech bubble + "F" built from primitives so it renders identically
// everywhere (no font dependency). `fill` lets us recolor for mono variants.
function mark({ bubble, letter, tail = true }) {
  const f = `
    <rect x="372" y="332" width="74" height="300" rx="12" fill="${letter}"/>
    <rect x="372" y="332" width="250" height="74" rx="12" fill="${letter}"/>
    <rect x="372" y="446" width="186" height="66" rx="12" fill="${letter}"/>`;
  const tailPath = tail
    ? `<path d="M300 612 L300 720 L392 628 Z" fill="${bubble}"/>`
    : '';
  return `
    <rect x="262" y="232" width="500" height="440" rx="96" fill="${bubble}"/>
    ${tailPath}
    ${f}`;
}

function fullIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${TEAL}"/>
        <stop offset="1" stop-color="${TEAL_DARK}"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#g)"/>
    ${mark({ bubble: '#FFFFFF', letter: TEAL })}
  </svg>`;
}

// Adaptive foreground: transparent, mark scaled into the ~66% safe zone.
function adaptiveForeground() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <g transform="translate(512 512) scale(0.66) translate(-512 -452)">
      ${mark({ bubble: '#FFFFFF', letter: TEAL })}
    </g>
  </svg>`;
}

function splash() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${TEAL}"/>
        <stop offset="1" stop-color="${TEAL_DARK}"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" rx="220" fill="url(#g)"/>
    ${mark({ bubble: '#FFFFFF', letter: TEAL })}
  </svg>`;
}

// Android status-bar notification icon must be white on transparent.
function monoNotification() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <g transform="translate(512 512) scale(0.92) translate(-512 -452)">
      ${mark({ bubble: '#FFFFFF', letter: 'rgba(0,0,0,0.001)' })}
    </g>
  </svg>`;
}

async function render(svg, file, size) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(resolve(ASSETS, file));
  console.log('wrote', file, `${size}x${size}`);
}

await render(fullIcon(), 'icon.png', 1024);
await render(adaptiveForeground(), 'adaptive-icon.png', 1024);
await render(splash(), 'splash.png', 1024);
await render(monoNotification(), 'notification-icon.png', 96);
await render(fullIcon(), 'favicon.png', 48);
console.log('done');
