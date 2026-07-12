# Lumi — Official Lumixo Mascot Redesign Report

**Version:** 4.6.2  
**Character:** Lumi (original premium cream kitten)  
**Scope:** Full visual redesign + animation polish · **zero auth API / Supabase changes**

---

## Why redesign (not iterate)

The previous mascot was rejected for production quality:

| Issue | Previous | New Lumi |
|-------|----------|----------|
| Eyes | Solid black sockets + yellow pupils (uncanny) | White sclera + warm amber iris + soft pupil + catchlights |
| Proportions | Over-large head, clipart body | Soft loaf body, slightly oversized but natural head |
| Smile | Forced / hard stroke | Gentle W-mouth; happy / sad variants |
| Tail | Disconnected stick | S-curve rooted in body + fluffy tip |
| Finish | Flat shapes | Soft gradients, blush, volume highlights, ground shadow |

This is a **from-scratch original** character — not a patch of the old SVG/View tree.

---

## Design system

Shared tokens live in `shared/lumixoCat.ts`:

- **Moods:** `idle` · `watching` · `hiding` · `confused` · `celebrating` · `sleeping` · `wave` · `sad`
- **Sizes:** `xs` 56 · `sm` 88 · `md` 120 · `lg` 160 · `hero` 200
- **Palette:** cream fur (`#FFFCF7` → `#E8DFD2`), pink ears/nose, **Lumixo teal** collar (`#00A884` / `#06CF9C`)
- **Motion constants:** breath, tail, blink, hide, celebrate timings kept in sync web ↔ mobile

---

## Animation behaviours

| State | Trigger | Motion |
|-------|---------|--------|
| Idle | Default | Soft breath, random blink, ear twitch, slow tail sway |
| Watching | Email focus / typing | Eyes track gaze, head micro-rotate, alert ears, livelier tail |
| Hiding | Password focus | Both paws rise and **fully cover eyes** (never peek), soft smile, tail still sways |
| Confused | Wrong password / auth error (~2s) | Head tilt + shake, sad brows/mouth, then return |
| Celebrating | Successful login/signup | Bounce, tail wag, sparkles |
| Sleeping | Offline / calm empty | Closed lids, zzz (web) |
| Wave | Welcome / empty states | Gentle lean |
| Sad | Errors / broken reset link | Downturned mouth + soft brows |

---

## Platforms

| Platform | Implementation | Engine |
|----------|----------------|--------|
| **Web** | `web/src/mascot/LumixoCat.tsx` + `LumixoCat.css` | Original SVG + CSS `transform` / `opacity` only |
| **Mobile** | `mobile/src/components/LumixoCat.tsx` | Views + **Reanimated 3** (UI thread) |
| **Shared** | `shared/lumixoCat.ts` | Moods, sizes, palette, `catMoodFromAuth`, gaze helper |

No new native dependencies. No framer-motion on the cat. Auth screens only pass `mood` + `gaze`.

---

## Where Lumi appears

| Surface | Web | Mobile |
|---------|-----|--------|
| Login / Signup / Forgot password | ✅ Auth | ✅ AuthScreen |
| Reset password | ✅ ResetPassword | ✅ ResetPasswordScreen |
| Loading splash | ✅ appTree | — |
| Empty conversation list | ✅ App | ✅ ConversationsScreen |
| Empty chat welcome | ✅ App | — |
| Empty calls | ✅ CallsView | ✅ CallsScreen |
| Empty starred | ✅ StarredMessagesModal | ✅ StarredScreen |
| Empty mailbox | ✅ Mailbox | ✅ MailboxScreen |
| Error boundary | ✅ | ✅ |
| Settings → About (+ developer credit) | ✅ | ✅ |
| Static vector asset | `web/public/lumi.svg` · `mobile/assets/lumi.svg` | |

**Removed from login UI:** “Developed by LAKSHMESHWAR PANDEY” (web auth footer + mobile auth credit). Credit remains in **Settings → About** (and legal/help footers).

---

## Performance report (design + implementation)

### Targets

| Metric | Target | Approach |
|--------|--------|----------|
| Frame rate | **60 FPS** | Transform & opacity only; no layout thrash |
| JS thread | Low | Web: CSS animations on compositor; Mobile: Reanimated shared values |
| Memory | Stable | Timers cleared on unmount; `cancelAnimation` on mood change |
| Battery | Efficient | Low amplitude loops; `prefers-reduced-motion` / Reduce Motion freezes loops |
| Bundle | Light | Inline SVG / Views — no image assets, no new deps |
| Layout shift | None | Fixed size box (`CAT_SIZE_PX`); `contain: layout style` on web root |

### Auth integrity

- `signInWithEmail` / `signUpWithEmail` / `resetPasswordForEmail` / `updateUser` **unchanged**
- No Supabase client or RLS changes
- Parent owns success/error timers; mascot is pure presentational

### Measured / verified

| Check | Result |
|-------|--------|
| Web `tsc && vite build` | ✅ green |
| Mobile `tsc --noEmit` | ✅ green |
| Auth logic diff | Presentational only (mood props, footer removal) |

### Runtime expectations (device / browser)

| Env | FPS | CPU (idle mascot) | Notes |
|-----|-----|-------------------|-------|
| Desktop Chrome | ~60 | &lt; 2% compositor | CSS keyframes; no rAF loop |
| Mobile Safari / Chrome | ~60 | low | Same CSS path |
| Android / iOS (Reanimated) | ~60 | UI-thread anims | Breath + tail only while idle |
| Reduce Motion | static pose | negligible | Instant mood pose, no loops |

*FPS/CPU numbers are architecture targets verified by build hygiene and animation technique (transform/opacity, no continuous React re-renders). Device profiling can be captured in a QA session with Chrome DevTools Performance / Xcode Instruments / Android Studio Profiler.*

---

## Accessibility

- Decorative by default (`aria-hidden` / `no-hide-descendants`)
- Optional `decorative={false}` exposes `catAriaLabel(mood)`
- `prefers-reduced-motion` (web) and system Reduce Motion (mobile) disable looping animations
- Keyboard and form flows unchanged

---

## Version

| Field | Value |
|-------|-------|
| App version | **4.6.2** |
| Android `versionCode` | **62** |
| Android `versionName` | **4.6.2** |

---

## Files touched (primary)

- `shared/lumixoCat.ts` — palette + motion contract
- `web/src/mascot/LumixoCat.tsx` · `LumixoCat.css` — full SVG redesign
- `mobile/src/components/LumixoCat.tsx` — full View redesign
- `web/src/Auth.tsx` · `ResetPassword.tsx` — mascot + footer cleanup
- `mobile/src/screens/AuthScreen.tsx` · `ResetPasswordScreen.tsx` — mascot + credit cleanup
- Empty / error surfaces on web + mobile
- Branding / version bumps to **4.6.2**

---

## Summary

Lumi is now a **premium original cream kitten** with warm friendly eyes, natural proportions, a teal brand collar, and smooth 60 FPS-oriented animations shared across Android, iOS, and Web — with **zero impact on authentication logic**.
