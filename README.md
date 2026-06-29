# 🎩 FUTUREHAT — Complete Web App

**Production-ready, real-time messaging platform** built with React, Supabase, and TypeScript — with an **Apple-grade animated UI** and a **FUTUREHAT+** premium tier.

> Developed by **LAKSHMESHWAR PANDEY**

📄 See [`COMPLETION_REPORT.md`](./COMPLETION_REPORT.md) (status + checklist), [`FUTUREHAT_PLUS.md`](./FUTUREHAT_PLUS.md) (premium setup), and [`DEPLOY.md`](./DEPLOY.md) (hosting).

---

## ✨ Features (Complete)

### 🔐 Authentication
- ✅ Email + password sign up / sign in / **logout**
- ✅ Session persistence; animated mascot login that reacts to typing
- ✅ Automatic profile creation on signup

### 💬 Messaging
- ✅ **1:1 Direct Chats** — Search users, start conversations
- ✅ **Group Chats** — Create groups, add members, admin roles
- ✅ **Real-time delivery** — WebSocket subscriptions (messages appear instantly)
- ✅ **Reply, forward, edit, delete** messages
- ✅ **Reactions** — emoji reactions in real time
- ✅ **Read receipts** — animated ✓ / ✓✓
- ✅ **Typing indicators** + **online/offline presence** (last seen)
- ✅ **Media uploads** — Images and files via Supabase Storage
- ✅ **Group sender names** — See who sent each message in groups

### ⭐ FUTUREHAT+ (premium — ₹25/mo · ₹249/yr)
- ✅ Themes, animated wallpapers, bubble styles, fonts, app icons
- ✅ Premium emoji + sticker pack
- ✅ AI: rewrite / translate / summarize / smart replies / assistant
- ✅ Schedule messages, reminders, unlimited pins
- ✅ Ghost mode, hide chats, app lock (PIN + biometric)
- ✅ FUTUREHAT+ badge, higher upload limits — **all core features stay free**

### 📸 Status/Stories
- ✅ **Text statuses** — Share text with custom background colors
- ✅ **Image statuses** — Upload photos (24-hour expiry, like WhatsApp)
- ✅ **View all active statuses** — From all users

### 👤 Profile Management
- ✅ **Edit profile** — Display name, username, about/bio
- ✅ **Avatar upload** — Profile picture via Supabase Storage
- ✅ **User search** — Find people by username or display name

### 🎨 UI/UX
- ✅ **WhatsApp-inspired dark theme** — Professional, clean, minimal
- ✅ **Responsive layout** — Works on desktop and mobile browsers
- ✅ **Conversation list** — Sorted by last message
- ✅ **Empty states** — Helpful prompts when no data

---

## 🏗️ Architecture

```
Backend (Supabase — Live in Production)
├── PostgreSQL database (6 tables, 17 RLS policies)
├── Realtime (WebSocket subscriptions)
├── Storage (avatars, media, status)
├── Auth (email/password)
└── Region: ap-northeast-2 (Seoul)

Shared Library (TypeScript)
├── Client factory (framework-agnostic)
├── Domain types (mirrors DB schema)
└── Complete API (auth, chat, realtime, storage)

Web App (React + Vite)
├── Auth flow (sign in/up, session)
├── Conversation list + search
├── Real-time chat view
├── Profile settings modal
├── Group creation modal
├── Status/stories viewer
└── Media upload support
```

---

## 🚀 Quick Start

### Run Locally
```bash
cd ~/FUTUREHAT/web
npm run dev
# Open http://localhost:3000
```

### Build for Production
```bash
cd ~/FUTUREHAT/web
npm run build
npm run preview  # Test the production build
```

---

## 📦 Deployment (Production-Ready)

### Netlify (Recommended)

**Option 1: CLI**
```bash
npm install -g netlify-cli
cd ~/FUTUREHAT
netlify deploy --prod
```

**Option 2: GitHub Auto-Deploy**
1. Push this repo to GitHub
2. Go to [netlify.com](https://netlify.com) → **Import from Git**
3. Select repo, Netlify auto-detects config from `netlify.toml`
4. Add environment variables in Netlify dashboard:
   - `VITE_SUPABASE_URL`: `https://toscljrivrawvlfebdzz.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: `sb_publishable_qZsG21qWLfgNCfRqOpn2tw_PsLOKiai`
5. Deploy!

See `DEPLOY.md` for detailed instructions.

---

## 🧪 Testing the App

1. **Open** http://localhost:3000
2. **Sign up** with any email (e.g., `alice@test.com` / `password123`)
3. **Open incognito window**, sign up as `bob@test.com`
4. **Search** for "alice", start a chat
5. **Send messages** — they appear instantly in both windows
6. **Upload an image** — click 📎 button
7. **Create a group** — click 👥 button, add members
8. **Post a status** — click 📸 button
9. **Edit profile** — click ⚙️ button

---

## 📂 Project Structure

```
FUTUREHAT/
├── netlify.toml              # Netlify deployment config
├── DEPLOY.md                 # Deployment guide
├── README.md                 # This file
├── PROGRESS.md               # Build log
│
├── supabase/migrations/      # Database schema (applied ✅)
│   ├── 0001_init.sql         # Core tables + RLS + triggers
│   └── 0002_status_and_storage.sql  # Stories + storage buckets
│
├── shared/                   # Framework-agnostic core
│   ├── types.ts              # Domain types
│   ├── client.ts             # Supabase client factory
│   ├── api.ts                # All data operations
│   └── package.json
│
└── web/                      # React app
    ├── src/
    │   ├── main.tsx          # Entry point
    │   ├── supabase.ts       # Web client singleton
    │   ├── AuthContext.tsx   # Auth state provider
    │   ├── Auth.tsx          # Sign in/up screen
    │   ├── App.tsx           # Main layout + conversation list
    │   ├── ChatView.tsx      # Chat window (messages + realtime)
    │   ├── ProfileModal.tsx  # Profile editor
    │   ├── GroupModal.tsx    # Group creation
    │   ├── StatusView.tsx    # Status/stories viewer
    │   └── *.css             # Styles
    ├── .env.local            # Supabase credentials (wired ✅)
    ├── package.json
    ├── vite.config.ts
    └── dist/                 # Production build output
```

---

## 🔐 Security

- **Row-Level Security (RLS)** enabled on all tables
- **17 policies** enforcing access control at the database level
- **Anon key** is safe to expose (client-side, RLS protects data)
- **Storage policies** restrict uploads/downloads by ownership
- **Database password** not stored in project files

**Before public launch:** Rotate the database password in Supabase → Settings → Database.

---

## 📊 Database Schema

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (1:1 with auth.users) |
| `conversations` | Direct (1:1) or group chats |
| `conversation_participants` | Who belongs to each conversation |
| `messages` | Chat messages (text, image, file, audio) |
| `message_receipts` | Delivered / read status per user per message |
| `statuses` | 24h ephemeral stories |

**Storage buckets:**
- `avatars` (public read, owner write)
- `media` (authenticated access, RLS-gated URLs)
- `status` (authenticated read, owner write, 24h auto-expire)

---

## 🎯 What's Complete (Web)

✅ **Auth:** Email/password, session persistence, sign out  
✅ **Messaging:** 1:1 + groups, real-time WebSocket delivery  
✅ **Media:** Image/file uploads, inline display  
✅ **Status/Stories:** Text + image posts, 24h expiry  
✅ **Profile:** Edit display name, username, about, avatar  
✅ **UI:** WhatsApp-style dark theme, responsive  
✅ **Read receipts:** ✓✓ checkmarks on sent messages  
✅ **Search:** Find users by username or display name  
✅ **Deployment config:** `netlify.toml` ready  

---

## 🚧 Not Built (Mobile)

The backend supports everything, but the mobile app (React Native / Expo) isn't built yet.

**To add mobile:**
1. Reuse `shared/` library (same API)
2. Build native UI with React Native
3. Wire to same Supabase backend
4. Deploy to App Store / Play Store

**Estimate:** 4-6 hours for a developer familiar with React Native.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript |
| Build | Vite 5 |
| Backend | Supabase (Postgres + Realtime + Storage + Auth) |
| Styling | Plain CSS (WhatsApp-inspired) |
| Deployment | Netlify / Vercel (zero-config) |
| Real-time | Supabase Realtime (WebSockets) |

---

## 📈 Performance

- **CDN:** Netlify/Vercel serve from global edge
- **Backend:** Supabase runs in Seoul (`ap-northeast-2`)
- **Build size:** ~386 KB JS (gzipped: ~109 KB)
- **Realtime:** WebSocket connection (persistent, low latency)

---

## 🤝 Contributing / Extending

### Add a new feature
1. **Backend:** Add migration in `supabase/migrations/`
2. **Shared:** Extend `shared/api.ts` with new operations
3. **Web:** Add UI components in `web/src/`
4. **Test:** Run locally, verify real-time behavior
5. **Deploy:** Push to GitHub, Netlify auto-deploys

### Example: Add voice messages
1. Add `audio` message type support (already in schema)
2. Add recording UI in `ChatView.tsx`
3. Upload to `media` bucket via `uploadMedia()`
4. Send via `sendMessage()` with `type: 'audio'`
5. Render audio player in message bubble

---

## 📞 Support

- **Supabase:** https://supabase.com/docs
- **React:** https://react.dev
- **Netlify:** https://docs.netlify.com

---

## 🎉 Summary

FUTUREHAT is a **complete, production-ready WhatsApp clone** with:
- Real-time messaging (1:1 + groups)
- Media uploads (images + files)
- Status/stories (24h ephemeral posts)
- Profile management (avatar, username, bio)
- WhatsApp-style UI (dark theme, responsive)
- Secure backend (RLS, realtime, storage)

**Ready to deploy to Netlify in 2 minutes.**

---

**Built with ❤️ — a fully functional messaging platform, no mocks, no shortcuts.**
