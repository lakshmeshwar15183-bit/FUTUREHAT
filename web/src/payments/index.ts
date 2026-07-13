// Lumixo+ — payment provider factory.
//
// Production: Razorpay when the Edge Function has RAZORPAY_KEY_ID/SECRET set.
// Clients discover readiness via getRazorpayConfig() (no secrets).
// VITE_RAZORPAY_KEY_ID is optional public key fallback only — never put KEY_SECRET in Vite env.

import type { PaymentProvider } from '@shared/payments/provider';
import { ManualProvider } from '@shared/payments/provider';
import { RazorpayWebProvider } from './razorpay';
import { getRazorpayConfig } from '@shared/payments/razorpayApi';
import { supabase } from '../supabase';

let cachedReady: boolean | null = null;
let cachedKeyId: string | null = null;

/** Probe Edge Function once per session (public key id only). */
export async function refreshPaymentsReady(): Promise<boolean> {
  try {
    const { config } = await getRazorpayConfig(supabase);
    cachedReady = !!config?.configured;
    cachedKeyId = config?.keyId ?? null;
    return cachedReady;
  } catch {
    cachedReady = false;
    cachedKeyId = null;
    return false;
  }
}

export function getPaymentProvider(): PaymentProvider {
  // Prefer server-reported public key; optional Vite public key is fallback only.
  const viteKey = import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined;
  const key = cachedKeyId || viteKey;
  if (cachedReady === true || key) {
    return new RazorpayWebProvider(key);
  }
  return new ManualProvider();
}

/**
 * Synchronous hint for UI. Prefer refreshPaymentsReady() on modal open.
 * True when server config was ready or a public key id is present for checkout.
 */
export function activeProviderId(): string {
  const viteKey = import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined;
  if (cachedReady === true || cachedKeyId || viteKey) return 'razorpay';
  return 'manual';
}

export function paymentsLikelyReady(): boolean {
  return activeProviderId() === 'razorpay';
}
