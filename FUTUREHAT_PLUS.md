# FUTUREHAT+ — Premium System & Deploy Guide

FUTUREHAT+ is the premium tier. **Every core messaging feature stays free.** Premium
adds enhancements only. Pricing: **₹25/month** or **₹249/year**.

> Developed by **LAKSHMESHWAR PANDEY**

---

## 1. Apply the database migrations (required, one time)

The premium tables (and the reactions table from the earlier polish pass) are **not
yet applied** to the live Supabase project. Apply them once.

### Easiest: Supabase SQL Editor
1. Open your project → **SQL Editor** → **New query**.
2. Paste and run each file's contents, in order:
   - `supabase/migrations/20240102000000_add_message_reactions.sql`
   - `supabase/migrations/0003_premium.sql`
3. Both are idempotent (safe to re-run).

### Or: Supabase CLI (from the repo root)
```bash
supabase link --project-ref toscljrivrawvlfebdzz
supabase db push
```

After this: subscriptions, preferences, pins, hidden chats, scheduled messages,
reactions, the `is_premium()` function, and the `premium_users` view all exist.

> The app is built to **degrade gracefully** — before the migrations are applied it
> simply behaves as the free tier (no crashes). After applying, premium unlocks.

---

## 2. Deploy the web app

```bash
cd web
npm install
npm run build          # outputs web/dist
```

Netlify (auto-detected from `netlify.toml`) or Vercel — set env vars:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_RAZORPAY_KEY_ID` *(optional — see §4)*

Full host-by-host steps are in `DEPLOY.md`.

---

## 3. Optional writing tools (server-side)

Optional rewrite / translate / summarize / suggested-reply features run through a
Supabase Edge Function. Premium status is enforced **server-side**. Provider
credentials never ship in the mobile or web clients.

```bash
supabase functions deploy ai
supabase secrets set AI_API_KEY=your-provider-key
supabase secrets set AI_BASE_URL=https://your-provider-gateway.example
# Optional model id:
supabase secrets set AI_MODEL=default
```

Without this set up, the rest of Lumixo+ still works; writing-tool actions return a
configuration error if invoked.

---

## 4. Payments (Razorpay — production)

Full guide: **[`RAZORPAY.md`](./RAZORPAY.md)**.

- Premium is **never** activated from the client. `activateSubscription` is fail-closed.
- Edge Function `payments-razorpay` creates Orders, verifies HMAC signatures, records
  rows in `razorpay_payments`, and calls `admin_activate_subscription` (service role).
- Secrets (server only): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, optional
  `RAZORPAY_WEBHOOK_SECRET`.
- Plans: **₹25/month** · **₹249/year** (`shared/premium/plans.ts`).
- Web + mobile both use server `create_order` → Checkout → server `verify`.

```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx
supabase functions deploy payments-razorpay
# Apply migration 0054_razorpay_payments.sql
```

---

## 5. Scheduled messages (server dispatch)

Messages scheduled for later are flushed by `dispatch_due_messages()`. The app calls
it while a chat is open; for delivery when nobody is online, schedule it with
**pg_cron** (Supabase → Database → Extensions → enable `pg_cron`):

```sql
select cron.schedule('fh-dispatch', '* * * * *', $$ select public.dispatch_due_messages(); $$);
```

---

## 6. How premium is structured (for future expansion)

- **`shared/premium/features.ts`** — the single registry of every premium feature,
  tagged `live` (functional now) or `soon` (registered + gated, ready to build).
  Add a feature = add a line here; the upgrade page and gates pick it up.
- **`shared/premium/plans.ts`** — pricing.
- **`shared/premiumApi.ts`** — all premium data access (subscription, preferences,
  pins, hidden, scheduled).
- **`web/src/PremiumContext.tsx`** — `isPremium`, preferences, premium-user set.
- **`web/src/premium/UpgradeProvider.tsx`** — `useUpgrade().open()`; gate any action
  by checking `usePremium().isPremium` and calling `open()` when false.
- **`web/src/theme/`** — themes, fonts, bubbles, wallpapers, app icons.

### What's live today
Themes · animated wallpapers · chat-bubble styles · fonts · app icons · premium
emoji · schedule messages · reminders · unlimited pins · ghost mode · hide chats ·
app lock (PIN + biometric) · higher upload limits · Lumixo+ badge · profile
decorations · early access.

### Registered & gated (expand next)
Animated stickers · extra sticker packs · auto-replies · longer edit history ·
larger cloud backup · advanced media manager · advanced privacy.

---

**Free forever for everyone. Premium for those who want more.** 🎩✦
