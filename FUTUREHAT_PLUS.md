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

## 3. AI features (optional but recommended)

AI rewrite / translate / summarize / smart-reply run through a Supabase Edge
Function that calls the Anthropic API. Premium status is enforced **server-side**.

```bash
supabase functions deploy ai
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
# Optional — use an Anthropic-compatible proxy instead of api.anthropic.com:
supabase secrets set ANTHROPIC_BASE_URL=https://cc.freemodel.dev
# Optional — override the model id:
supabase secrets set ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

The endpoint is configurable (`ANTHROPIC_BASE_URL`), so any Anthropic-compatible
gateway works. Note: chat transcripts are sent to whichever endpoint you configure.
Without this set up, the rest of FUTUREHAT+ still works; AI actions show a friendly error.

---

## 4. Payments

The upgrade flow uses a provider abstraction (`shared/payments`).

- **No keys set** → `ManualProvider`: the upgrade button **instantly activates** the
  subscription in the database. Fully functional for testing / self-serve.
- **`VITE_RAZORPAY_KEY_ID` set** → real Razorpay checkout opens for ₹25 / ₹249.

> For signed server-side verification, create a Razorpay *Order* in an edge function
> and pass its id into `RazorpayWebProvider`. The seam for this is already in place.

Add a gateway by implementing `PaymentProvider` and returning it from
`web/src/payments/index.ts`. Nothing else changes.

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
emoji · AI rewrite/translate/summarize/smart-reply · schedule messages · reminders ·
unlimited pins · ghost mode · hide chats · app lock (PIN + biometric) · higher upload
limits · FUTUREHAT+ badge · profile decorations · early access.

### Registered & gated (expand next)
Premium/animated/AI stickers · premium sticker packs · auto-replies · longer edit
history · larger cloud backup · advanced media manager · advanced privacy.

---

**Free forever for everyone. Premium for those who want more.** 🎩✦
