// FUTUREHAT+ — payment provider factory. Selects a real gateway when configured,
// otherwise the functional ManualProvider. Add new gateways here only.

import type { PaymentProvider } from '@shared/payments/provider';
import { ManualProvider } from '@shared/payments/provider';
import { RazorpayWebProvider } from './razorpay';

export function getPaymentProvider(): PaymentProvider {
  const rzpKey = import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined;
  if (rzpKey) return new RazorpayWebProvider(rzpKey);
  return new ManualProvider();
}

export function activeProviderId(): string {
  return import.meta.env.VITE_RAZORPAY_KEY_ID ? 'razorpay' : 'manual';
}
