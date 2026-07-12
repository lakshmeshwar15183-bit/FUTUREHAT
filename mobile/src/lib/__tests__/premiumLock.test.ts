/**
 * P0: source-level guard that free/manual premium activation stays disabled.
 * Avoids Jest ESM path issues with the shared package.
 */
import * as fs from 'fs';
import * as path from 'path';

describe('premium free-grant lock (source contract)', () => {
  it('ManualProvider fails closed in source', () => {
    const p = path.join(__dirname, '../../../../shared/payments/provider.ts');
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/ok:\s*false/);
    expect(src).toMatch(/Secure payments are not configured/);
  });

  it('activateSubscription is permanently fail-closed in source', () => {
    const p = path.join(__dirname, '../../../../shared/premiumApi.ts');
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/Client activation is disabled/);
    expect(src).not.toMatch(/\.from\(['"]subscriptions['"]\)\s*\.upsert/);
  });

  it('mobile PremiumScreen does not call activateSubscription', () => {
    const p = path.join(__dirname, '../../screens/PremiumScreen.tsx');
    const src = fs.readFileSync(p, 'utf8');
    expect(src).not.toMatch(/activateSubscription\s*\(/);
    expect(src).toMatch(/PAYMENTS_READY = false/);
  });
});
