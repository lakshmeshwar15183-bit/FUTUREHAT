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

  it('mobile PremiumScreen never self-grants; only server verify path', () => {
    const p = path.join(__dirname, '../../screens/PremiumScreen.tsx');
    const src = fs.readFileSync(p, 'utf8');
    expect(src).not.toMatch(/activateSubscription\s*\(/);
    expect(src).toMatch(/verifyRazorpayPayment/);
    expect(src).toMatch(/createRazorpayOrder/);
    expect(src).not.toMatch(/\.from\(['"]subscriptions['"]\)\s*\.upsert/);
  });

  it('edge payments function never returns KEY_SECRET to clients', () => {
    const p = path.join(__dirname, '../../../../supabase/functions/payments-razorpay/index.ts');
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toMatch(/RAZORPAY_KEY_SECRET/);
    expect(src).toMatch(/admin_activate_subscription/);
    // Public responses may include keyId only — never ship the secret in JSON bodies.
    expect(src).not.toMatch(/json\([^)]*KEY_SECRET/);
    expect(src).not.toMatch(/keySecret\s*:\s*KEY_SECRET/);
    expect(src).toMatch(/keyId:\s*configured \? KEY_ID : null/);
  });
});
