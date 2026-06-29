// FUTUREHAT+ — pricing plans. Prices in INR.

import type { PlanId } from '../types.js';

export interface Plan {
  id: PlanId;
  label: string;
  priceInr: number;       // headline price in rupees
  amountPaise: number;    // amount in paise (for Razorpay/Stripe)
  period: string;         // human-readable period
  periodDays: number;     // used to compute current_period_end
  badge?: string;         // marketing badge e.g. "Best value"
  perMonthInr?: number;   // effective monthly cost for yearly
}

export const PLANS: Record<PlanId, Plan> = {
  monthly: {
    id: 'monthly',
    label: 'Monthly',
    priceInr: 25,
    amountPaise: 2500,
    period: 'month',
    periodDays: 30,
  },
  yearly: {
    id: 'yearly',
    label: 'Yearly',
    priceInr: 249,
    amountPaise: 24900,
    period: 'year',
    periodDays: 365,
    badge: 'Best value · 2 months free',
    perMonthInr: 21,
  },
};

export const PLAN_LIST: Plan[] = [PLANS.monthly, PLANS.yearly];

export function formatInr(rupees: number): string {
  return `₹${rupees.toLocaleString('en-IN')}`;
}
