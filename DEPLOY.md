# FUTUREHAT Web — Deployment Guide

> Developed by **LAKSHMESHWAR PANDEY**

## 0. Apply database migrations first (one time)

The reactions + FUTUREHAT+ premium tables aren't on the live DB yet. Apply them via
the Supabase **SQL Editor** (paste each file, in order) or the CLI:

```bash
supabase link --project-ref toscljrivrawvlfebdzz
supabase db push
```

Files: `supabase/migrations/20240102000000_add_message_reactions.sql`, then
`supabase/migrations/0003_premium.sql`. Both are idempotent. Full premium setup
(AI edge function, payments, scheduled-message cron) is in **`FUTUREHAT_PLUS.md`**.

> The app runs fine as the free tier even before migrations are applied — it degrades
> gracefully, so you can deploy first and apply migrations any time.

## 🚀 Deploy to Netlify (2 minutes)

### Option 1: CLI (Fastest)

1. Install Netlify CLI:
   ```bash
   npm install -g netlify-cli
   ```

2. Deploy from the project root:
   ```bash
   cd ~/FUTUREHAT
   netlify deploy --prod
   ```

3. Follow prompts:
   - Authorize with your Netlify account
   - Create a new site or link to existing
   - Build command: `npm run build`
   - Publish directory: `web/dist`

4. Set environment variables in Netlify dashboard:
   - `VITE_SUPABASE_URL`: `https://toscljrivrawvlfebdzz.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `sb_publishable_qZsG21qWLfgNCfRqOpn2tw_PsLOKiai`
   - `VITE_RAZORPAY_KEY_ID` *(optional — only for live FUTUREHAT+ billing)*

### Option 2: GitHub + Netlify Auto-Deploy

1. Push to GitHub:
   ```bash
   cd ~/FUTUREHAT
   git add .
   git commit -m "Initial FUTUREHAT web app"
   git remote add origin https://github.com/YOUR_USERNAME/futurehat.git
   git push -u origin main
   ```

2. Go to [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**

3. Select your repository

4. Build settings (auto-detected from `netlify.toml`):
   - Base directory: `web`
   - Build command: `npm run build`
   - Publish directory: `web/dist`

5. Add environment variables:
   - `VITE_SUPABASE_URL`: `https://toscljrivrawvlfebdzz.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `sb_publishable_qZsG21qWLfgNCfRqOpn2tw_PsLOKiai`

6. Deploy!

---

## ⚡ Deploy to Vercel (Alternative)

1. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```

2. Deploy:
   ```bash
   cd ~/FUTUREHAT/web
   vercel --prod
   ```

3. Set environment variables in Vercel dashboard or via CLI:
   ```bash
   vercel env add VITE_SUPABASE_URL production
   vercel env add VITE_SUPABASE_ANON_KEY production
   ```

---

## 🔧 Pre-Deployment Checklist

- [x] Backend live (Supabase project running)
- [x] Environment variables set
- [x] Production build tested locally (`npm run build && npm run preview`)
- [ ] Custom domain configured (optional)
- [ ] HTTPS enabled (automatic on Netlify/Vercel)
- [ ] Rotate database password (recommended before public launch)

---

## 🌐 After Deployment

1. Test the live URL
2. Create test accounts and verify real-time messaging works
3. Share the link!

---

## 📊 Performance Tips

- Netlify/Vercel serve assets from global CDN (already optimized)
- Supabase is in `ap-northeast-2` (Seoul) — if most users are elsewhere, consider multi-region or replication
- Enable Netlify Analytics for traffic insights (optional, paid)

---

## 🔐 Security Reminder

Your `VITE_SUPABASE_ANON_KEY` is safe to expose in client apps — Row-Level Security (RLS) enforces all access control at the database level.

Before going public, **rotate your database password** in Supabase → Settings → Database.

---

**Your app is production-ready. Deploy and share!**
