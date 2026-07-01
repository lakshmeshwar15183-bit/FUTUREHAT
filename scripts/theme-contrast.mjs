// WCAG 2.1 contrast audit of the mobile palettes. Parses palettes.ts and checks
// every meaningful text/background pairing per theme against AA thresholds
// (4.5:1 normal text, 3:1 large/UI). Real computation, not eyeballing.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../mobile/src/theme/palettes.ts', import.meta.url), 'utf8');
// crude but reliable parse of `key: '#hex',` inside each palette block
function palette(name) {
  const block = src.split(`${name}: {`)[1].split('},')[0];
  const o = {};
  for (const m of block.matchAll(/(\w+):\s*'(#[0-9a-fA-F]{3,8})'/g)) o[m[1]] = m[2];
  return o;
}
const hex = (h) => { h = h.replace('#',''); if (h.length===3) h=[...h].map(c=>c+c).join(''); return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)); };
const lin = (c) => { c/=255; return c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4; };
const L = (h)=>{ const[r,g,b]=hex(h); return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); };
const ratio=(a,b)=>{ const l1=L(a),l2=L(b); const hi=Math.max(l1,l2),lo=Math.min(l1,l2); return (hi+0.05)/(lo+0.05); };

let fails=0;
function check(theme,label,fg,bg,min=4.5){
  const r=ratio(fg,bg); const pass=r>=min;
  if(!pass) fails++;
  console.log(`  ${pass?'✅':'❌'} ${label.padEnd(30)} ${fg} on ${bg}  ${r.toFixed(2)}:1  (need ${min})`);
}

for (const name of ['dark','light','amoled']) {
  const p = palette(name);
  console.log(`\n── ${name.toUpperCase()} ──`);
  // body text on every surface it appears on
  check(name,'text / surface',        p.text, p.surface);
  check(name,'text / bg',             p.text, p.bg);
  check(name,'textMuted / surface',   p.textMuted, p.surface);
  check(name,'textMuted / bg',        p.textMuted, p.bg);
  check(name,'textFaint / surface',   p.textFaint, p.surface);
  check(name,'textFaint / bg',        p.textFaint, p.bg);
  // incoming bubble text
  check(name,'text / bubbleIn',       p.text, p.bubbleIn);
  check(name,'textFaint / bubbleIn',  p.textFaint, p.bubbleIn);
  // OUTGOING bubble — the reported bug: its text must track the bubble fill
  check(name,'bubbleOutText / bubbleOut', p.bubbleOutText, p.bubbleOut);
  check(name,'bubbleOutMuted / bubbleOut',p.bubbleOutMuted, p.bubbleOut, 4.5);
  // gold accent as TEXT on surface
  check(name,'accentPlusText / surface',  p.accentPlusText, p.surface, 3);
  // white on primary buttons / header
  check(name,'white / primary',       '#FFFFFF', p.primary, 3);
  check(name,'white / header',        '#FFFFFF', p.header, 3);
  // dark badge text on gold fill
  check(name,'#0b141a / accentPlus',  '#0b141a', p.accentPlus);
}
console.log(`\n${fails===0?'ALL PAIRINGS PASS ✅':`${fails} PAIRING(S) BELOW THRESHOLD ❌`}`);
process.exit(fails===0?0:1);
