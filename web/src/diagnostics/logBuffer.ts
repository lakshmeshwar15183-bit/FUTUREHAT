// Lumixo — lightweight in-memory diagnostic log ring buffer. Call
// initDiagnostics() once at startup (from main.tsx during recovery wiring) to
// start capturing uncaught errors and rejections; use logDiag() to record notable
// events, and getDiagnostics() to read them for the Diagnostics export.

const MAX = 200;
const buf: string[] = [];
let started = false;

function push(line: string) {
  buf.push(`[${new Date().toISOString()}] ${line}`);
  if (buf.length > MAX) buf.shift();
}

export function initDiagnostics() {
  if (started) return;
  started = true;
  window.addEventListener('error', (e) => push(`error: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e) => push(`unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`));
  push('diagnostics initialised');
}

export function logDiag(message: string) { push(message); }
export function getDiagnostics(): string[] { return [...buf]; }
