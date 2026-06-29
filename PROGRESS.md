# FUTUREHAT — Progress Log

**Built:** 2026-06-28  
**Status:** ✅ Web app functional and running, backend live in production

---

## ✅ Completed

### 1. Project Scaffold
- Monorepo structure: `supabase/`, `shared/`, `web/`, `mobile/`
- Git initialized, `.gitignore`, env templates

### 2. Backend (Supabase — Production)
- **Database schema:** 6 tables (profiles, conversations, participants, messages, receipts, statuses)
- **RLS policies:** 17 policies securing all data
- **Realtime:** Postgres changes published to WebSocket subscribers
- **Storage:** 3 buckets (avatars, media, status) with access policies
- **Triggers:** Auto-create profile on signup
- **RPC:** `start_direct_conversation` (idempotent 1:1 chat creation)
- **Migrations applied:** Both SQL files run successfully on live database
- **Region:** ap-northeast-2 (Seoul)
- **Connection:** IPv4 pooler (`aws-1-ap-northeast-2.pooler.supabase.com`)

### 3. Shared Library (`shared/`)
- **client.ts:** Supabase client factory (works on web + mobile)
- **types.ts:** Full TypeScript types for all tables + view models
- **api.ts:** Complete data-access layer:
  - Auth: signUp, signIn, signOut, onAuthChange
  - Profiles: get, update, search
  - Conversations: start direct, create group, list with summaries
  - Messages: send, get, markAsRead
  - Realtime: subscribe to messages + receipts
  - Status/stories: create, list active
  - Storage: upload media, upload avatar
- Dependencies installed (`@supabase/supabase-js`)

### 4. Web App (`web/`)
- **Framework:** React 18 + Vite 5 + TypeScript
- **Auth:**
  - Email + password sign in/up (no paid SMS provider)
  - AuthContext provider with session persistence
  - Sign out
- **UI Components:**
  - `Auth.tsx`: Sign in/up screen (clean, branded)
  - `App.tsx`: Main layout (sidebar + chat view)
    - Conversation list (sorted by last message)
    - User search (by username/display name)
    - Start new direct chats
  - `ChatView.tsx`: Real-time chat window
    - Message history
    - Send messages
    - **Live WebSocket subscription** (new messages appear instantly)
    - Read receipts tracked (not displayed yet)
- **Styling:** WhatsApp-inspired dark theme, fully responsive
- **Build:** Compiles successfully, zero errors
- **Dev server:** Running at http://localhost:3000 (PID in `/tmp/fh-web-dev.pid`)
- Dependencies installed (React, Vite, date-fns, Supabase client)

### 5. Documentation
- **README.md:** Complete guide (architecture, setup, commands, deployment)
- **This log**

---

## 🚧 Not Yet Built (Mobile + Features)

### Mobile App
- React Native (Expo) app
- Reuses the entire `shared/` library
- iOS + Android builds
- **Estimate:** 4-6 hours

### Features (Backend Ready, UI Not Built)
- Group chat creation UI (backend RPC + schema exist)
- Media uploads UI (storage buckets + policies exist)
- Status/stories viewer (schema + API exist)
- Typing indicators (column exists, realtime logic TBD)
- Read receipt checkmarks in UI (data tracked, display pending)
- Profile editor (avatar, about, username)
- Push notifications (needs Firebase/APNs config)

### Deployment
- Web to Vercel/Netlify (zero-config, just connect repo)
- Mobile app store submission (Apple $99/year, Google $25 once)
- Backend already live (Supabase cloud, free tier)

---

## 🔐 Security Notes

- **DB password:** used once for migrations, not saved in project files. Rotate it in Supabase settings before going public.
- **RLS enabled** on all tables — users can only access their own data + conversations they belong to.
- **Anon key** in `.env.local` is safe to commit (client-side, RLS enforces security).

---

## 📊 Current State

| Component | Status | Details |
|-----------|--------|---------|
| Database | ✅ Live | 6 tables, 17 RLS policies, realtime enabled |
| Shared lib | ✅ Complete | Client + types + full API |
| Web app | ✅ Running | Auth + chat + realtime, http://localhost:3000 |
| Mobile app | ❌ Not started | Placeholder `.env` exists |
| Docs | ✅ Complete | README + this log |

---

## 🎯 To Test Right Now

1. Open http://localhost:3000
2. Sign up with any email (e.g., `test@example.com` / `password123`)
3. Open an incognito window, sign up as another user
4. Search for the first user by username, start a chat
5. Send messages — they appear **instantly** in both windows (realtime WebSocket)

---

## 🛠️ Useful Commands

```bash
# Start web dev server (if stopped)
cd ~/FUTUREHAT/web && npm run dev

# Stop dev server
kill $(cat /tmp/fh-web-dev.pid)

# Build for production
cd ~/FUTUREHAT/web && npm run build

# Run the production build locally
cd ~/FUTUREHAT/web && npm run preview
```

---

## 📝 Notes

- **Email auth chosen** to avoid paid Twilio for phone OTP (can add later if needed)
- **Real messages, real database, real realtime** — no mocks, no placeholders
- **Production-ready backend** — secure, scalable, globally accessible
- **Mobile will share the same backend** — just build native UI, plug in `shared/api.ts`

---

**End of log. The web app is functional, the backend is live, and you can chat in real-time right now.**
