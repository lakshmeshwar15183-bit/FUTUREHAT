/**
 * P0: Razorpay plan must be derived from paid amount, never client body.plan.
 * Mirrors supabase/functions/payments-razorpay/index.ts verify path.
 */
function planFromAmountPaise(amountPaise: number): 'monthly' | 'yearly' | null {
  if (amountPaise === 24900) return 'yearly';
  if (amountPaise === 2500) return 'monthly';
  return null;
}

describe('payment plan binding (amount → plan)', () => {
  it('maps monthly paise to monthly', () => {
    expect(planFromAmountPaise(2500)).toBe('monthly');
  });

  it('maps yearly paise to yearly', () => {
    expect(planFromAmountPaise(24900)).toBe('yearly');
  });

  it('rejects spoofed yearly when only monthly paid', () => {
    // Attacker sends body.plan=yearly but paid 2500
    expect(planFromAmountPaise(2500)).not.toBe('yearly');
  });

  it('rejects unknown amounts', () => {
    expect(planFromAmountPaise(100)).toBeNull();
    expect(planFromAmountPaise(0)).toBeNull();
  });
});
