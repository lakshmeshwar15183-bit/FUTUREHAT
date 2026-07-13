# Lumixo — Final UI/UX Polish & Smoothness Report

**Date:** 2026-07-12  
**Branch:** `parity/web-mobile-2026-07`  
**Scope:** Mobile design system, motion, list performance, high-traffic screens  
**Identity rule:** Benchmark responsiveness/polish vs WhatsApp/Telegram — **not** a visual clone.

---

## 1. UI issues found (and addressed)

| Issue | Severity | Status |
|-------|----------|--------|
| Inconsistent corner radii (18 vs 26 vs 22 across sheets/dialogs) | High | **Fixed** — tokens `radius.sm/md/lg/xl` + dialog/sheet aligned |
| Oversized dialogs / game-like chrome | High | **Fixed** (prior pass) — compact DialogHost |
| Tab icons used default RN size, labels inconsistent | Med | **Fixed** — 22pt icons, 11pt labels, hairline borders |
| FABs 56–60pt with heavy shadows | Med | **Fixed** — 54pt, softer elevation token |
| Auth card bulky borders / huge brand type | Med | **Fixed** — denser inputs, 48pt CTA, hairline card |
| Empty-state icons oversized (64pt+) | Low | **Improved** — iconSize.empty scale |
| Message bubbles vs list density mismatch | Med | **Fixed** (prior) + list perf this pass |
| LayoutAnimation using heavy preset on Android | Med | **Fixed** — `animateLayoutSoft()` (~160ms ease) |
| Chat scroll setState every frame for jump-FAB | High | **Fixed** — edge-triggered setState only |
| Emoji picker was a flat 30-emoji grid | High | **Fixed** (prior) — WhatsApp-class categories |

### Remaining UI inconsistencies (not fully closed this pass)

- Some admin/moderator screens still use local one-off paddings.
- Web `window.confirm` for destructive actions (browser-native, not DialogHost).
- Status/story viewers use separate motion curves (not yet on `motion` tokens).
- Camera/gallery native modules keep OEM chrome (by design).

---

## 2. UX issues found (and addressed)

| Issue | Status |
|-------|--------|
| Long-press menu cold-start latency (Modal) | Pre-fixed via always-mounted DialogHost |
| Accept-call from notification half-dead | Pre-fixed (`acceptCallById`) |
| Premium-gated emoji reactions (not WA-like) | Pre-fixed — free full emoji |
| Instant chat open / list jank on large accounts | **Improved** — FlatList window/batch tuning |
| Inconsistent press feedback | **Improved** — shared `press.ts` helpers ready |
| Touch targets under 44pt on some rows | Settings rows ≥48; hitSlop tokens documented |

---

## 3. Animations improved

| Surface | Change |
|---------|--------|
| **Design system** | New `theme/motion.ts` — open 170ms, close 140ms, sheet 180/150, shared easings |
| **DialogHost** | Uses global `motion` + `ease` tokens (no local magic numbers drift) |
| **Selection / chips** | Soft layout animation instead of heavy `easeInEaseOut` preset |
| **Stack navigation** | `slide_from_right` @ 220ms, full-screen gesture enabled |
| **FAB press** | Scale 0.96 + opacity (calls + chats) |
| **Emoji / dialogs** | Prior passes: fade+scale dialogs, sheet slide, emoji stay-open composer |

---

## 4. Performance optimizations

| Optimization | Where |
|--------------|--------|
| `listPerf.chatList` windowSize 9, batch 10, Android `removeClippedSubviews` | Conversations |
| `listPerf.messageList` same pattern + 16ms scroll throttle | Chat thread |
| Jump-to-latest: setState only on visibility edge | ChatScreen |
| `listPerf.generic` on Calls history | CallsScreen |
| `enableLayoutAnimations()` once at app boot | App.tsx |
| Memoized ChatRow / MessageBubble | Pre-existing, retained |
| Dialog host always mounted (no Modal cold start) | Pre-existing |

---

## 5. Screens / modules modified (this pass)

- `mobile/src/theme/palettes.ts` — icon/touch/density/lineHeight/elevation.sheet  
- `mobile/src/theme/motion.ts` — **new** motion + listPerf  
- `mobile/src/theme/index.ts` — exports  
- `mobile/src/ui/press.ts` — **new** ripple/press helpers  
- `mobile/src/ui/dialog/DialogHost.tsx` — motion token wiring  
- `mobile/App.tsx` — stack animation, layout animation enable  
- `mobile/src/screens/ConversationsScreen.tsx` — list perf, soft layout anim, FAB a11y  
- `mobile/src/screens/ChatScreen.tsx` — list perf, scroll setState fix  
- `mobile/src/screens/CallsScreen.tsx` — list perf, FAB polish  
- `mobile/src/screens/AuthScreen.tsx` — compact premium auth card  

**Prior related commits in this session:** dialog redesign, UI density polish, WhatsApp emoji system.

---

## 6. Remaining polish suggestions (backlog)

1. Wire `android_ripple` from `press.ts` across all list rows (Android Material).  
2. Status/MediaViewer open curves → import `timingOpen` / `motion.mediaMs`.  
3. Replace web `confirm()` with a shared web DialogHost.  
4. Virtualized flash-list (`@shopify/flash-list`) for 1000+ chat rows if needed.  
5. Per-message enter animation (subtle fade) with Reanimated layout — careful with inverted lists.  
6. Device lab QA on 60/90/120Hz + low-RAM Android.  
7. Dynamic type: audit `allowFontScaling` on bubbles/meta timestamps.

---

## 7–10. Scores (honest engineering assessment)

| Score | Value | Rationale |
|-------|-------|-----------|
| **7. UI Consistency** | **82 / 100** | Core tokens + dialogs/tabs/list/chat/auth aligned; admin/web stragglers remain |
| **8. UX** | **84 / 100** | Instant sheets, free emoji, call accept fix; offline/story edge cases still polishable |
| **9. Smoothness** | **80 / 100** | List/windowing + scroll setState fix; not yet profiled on mid-tier hardware in this session |
| **10. Overall Premium Feel** | **83 / 100** | Strong messenger density + motion system; rebuild required for device verification |

> Not claiming 95+ without device FPS profiling and full screen sweep of admin/moderator/stories.

---

## How to verify on device

Rebuild release APK (JS + native shell):

```bash
cd mobile/android && ./gradlew :app:assembleRelease
```

Smoke checklist: open chat list scroll, long-press menu &lt;100ms, open chat, send/react, emoji search, calls list, auth, dialogs light/dark.

---

## Identity note

Lumixo keeps its own branding (primary green, headers, chat layout). WhatsApp/Telegram were used as **responsiveness and density benchmarks**, not as a visual redesign mandate.
