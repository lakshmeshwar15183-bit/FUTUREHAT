// Lumixo+ — upgrade page. Plans, full feature grid, and a real checkout that
// activates the subscription in the database on success.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../AuthContext';
import { usePremium } from '../PremiumContext';
import { cancelSubscription } from '@shared/premiumApi';
import { supabase } from '../supabase';
import { PLAN_LIST, PLANS, formatInr } from '@shared/premium/plans';
import {
  PREMIUM_FEATURES,
  FEATURE_CATEGORIES,
  type FeatureCategory,
} from '@shared/premium/features';
import type { PlanId } from '@shared/types';
import { getPaymentProvider, activeProviderId } from '../payments';
import { modalBackdrop, modalPanel, spring } from '../motion';
import './UpgradeModal.css';

const CATEGORY_ORDER: FeatureCategory[] = [
  'customization', 'stickers', 'ai', 'messaging', 'privacy', 'storage', 'identity',
];

export function UpgradeModal({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const { isPremium, subscription, refresh } = usePremium();
  const [plan, setPlan] = useState<PlanId>('yearly');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [showSoon, setShowSoon] = useState(false);
  // Purchases are gated until a real gateway is configured. The moment Razorpay
  // keys are set (VITE_RAZORPAY_KEY_ID → activeProviderId() === 'razorpay'), the
  // real checkout button automatically replaces the "Available soon" CTA — no
  // code change needed. To force-enable for another gateway, adjust this line.
  const paymentsReady = activeProviderId() === 'razorpay';

  async function handleUpgrade() {
    if (!user) return;
    // P0: never run free/manual activation. Only real Razorpay (or future gateways).
    if (!paymentsReady) {
      setShowSoon(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const provider = getPaymentProvider();
      const result = await provider.checkout({
        plan,
        userId: user.id,
        email: user.email ?? undefined,
        displayName: profile?.display_name ?? undefined,
      });
      if (!result.ok) {
        setError(result.error || 'Payment was not completed');
        return;
      }
      if (result.provider === 'manual') {
        setError('Secure payments are not available. Manual activation is disabled.');
        return;
      }
      // Activation is performed server-side inside payments-razorpay (HMAC verify
      // + admin_activate_subscription). Client must not write subscriptions.
      await refresh();
      setDone(true);
    } catch (e: any) {
      setError(e.message || 'Could not activate subscription');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    setError('');
    const { error: cancelErr } = await cancelSubscription(supabase);
    if (cancelErr) setError(cancelErr.message || 'Could not cancel subscription');
    else await refresh();
    setBusy(false);
  }

  return (
    <motion.div className="modal-backdrop" variants={modalBackdrop} initial="initial" animate="animate" exit="exit" onClick={onClose}>
      <motion.div className="upgrade-modal glass" variants={modalPanel} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="upgrade-hero">
          <motion.div className="upgrade-crest" initial={{ scale: 0.6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={spring}>
            ✦
          </motion.div>
          <h1>Lumixo<span className="plus">+</span></h1>
          <p>Premium enhancements. Every core feature stays free, forever.</p>
        </div>

        <AnimatePresence mode="wait">
          {done ? (
            <motion.div key="done" className="upgrade-success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <div className="success-check">🎉</div>
              <h2>Welcome to Lumixo+</h2>
              <p>Your premium features are now unlocked.</p>
              <button className="upgrade-cta" onClick={onClose}>Start exploring</button>
            </motion.div>
          ) : isPremium ? (
            <motion.div key="member" className="upgrade-member" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="member-status">
                <span className="fh-badge">✦ Lumixo+</span>
                <p>
                  {subscription?.plan === 'yearly' ? 'Yearly' : 'Monthly'} plan ·
                  {subscription?.cancel_at_period_end ? ' ends ' : ' renews '}
                  {subscription ? new Date(subscription.current_period_end).toLocaleDateString() : '—'}
                </p>
                {subscription?.cancel_at_period_end && <p className="muted">Cancels at period end.</p>}
              </div>
              {error && <div className="upgrade-error">{error}</div>}
              {!subscription?.cancel_at_period_end && (
                <button className="upgrade-ghost" disabled={busy} onClick={handleCancel}>Cancel subscription</button>
              )}
            </motion.div>
          ) : (
            <motion.div key="buy" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="plan-grid">
                {PLAN_LIST.map((p) => (
                  <motion.button
                    key={p.id}
                    whileTap={{ scale: 0.98 }}
                    className={`plan-card ${plan === p.id ? 'selected' : ''}`}
                    onClick={() => setPlan(p.id)}
                  >
                    {p.badge && <div className="plan-badge">{p.badge}</div>}
                    <div className="plan-name">{p.label}</div>
                    <div className="plan-price">{formatInr(p.priceInr)}<span>/{p.period}</span></div>
                    {p.perMonthInr && <div className="plan-sub">≈ {formatInr(p.perMonthInr)}/month</div>}
                  </motion.button>
                ))}
              </div>

              {error && <div className="upgrade-error">{error}</div>}

              {paymentsReady ? (
                <motion.button whileTap={{ scale: 0.97 }} className="upgrade-cta" disabled={busy} onClick={handleUpgrade}>
                  {busy ? <span className="fh-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> :
                    `Upgrade — ${formatInr(PLANS[plan].priceInr)}/${PLANS[plan].period}`}
                </motion.button>
              ) : (
                <button type="button" className="upgrade-cta soon" onClick={() => setShowSoon(true)}>
                  Get Lumixo+ <span className="soon-tag">🟡 Available soon</span>
                </button>
              )}
              <div className="pay-note">
                {paymentsReady ? 'Secure payment via Razorpay' : 'Secure checkout is coming in a future update.'}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="feature-sections">
          {CATEGORY_ORDER.map((cat) => {
            // Only advertise features that work today — no "soon" placeholders.
            const feats = PREMIUM_FEATURES.filter((f) => f.category === cat && f.status !== 'soon');
            if (!feats.length) return null;
            const meta = FEATURE_CATEGORIES[cat];
            return (
              <div key={cat} className="feature-section">
                <h3>{meta.icon} {meta.label}</h3>
                <div className="feature-list">
                  {feats.map((f) => (
                    <div key={f.key} className="feature-item">
                      <span className="feature-ico">{f.icon}</span>
                      <div>
                        <div className="feature-title">{f.title}</div>
                        <div className="feature-desc">{f.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="upgrade-footer">Developed by LAKSHMESHWAR PANDEY</div>

        <AnimatePresence>
          {showSoon && (
            <motion.div className="soon-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowSoon(false)}>
              <motion.div className="soon-card" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}>
                <div className="soon-emoji">🟡</div>
                <h3>Available soon</h3>
                <p>Premium subscriptions will be available in a future update once secure payment integration is completed.</p>
                <button className="upgrade-cta" onClick={() => setShowSoon(false)}>Got it</button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
