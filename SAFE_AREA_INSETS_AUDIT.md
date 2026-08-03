# Safe Area & Window Insets Audit Report

**Priority:** P0 production blocker  
**App version:** 4.6.2+  
**Platform focus:** Android 3-button navigation (also gesture nav, iOS home indicator, cutouts)  
**Date:** 2026-07-12  

---

## Root cause (fixed)

Bottom tab bar used **hardcoded** dimensions:

```ts
// BEFORE (broken)
height: Platform.OS === 'ios' ? 84 : 58,
paddingBottom: Platform.OS === 'ios' ? 28 : 6,
```

On Android OEMs with a 3-button system nav bar (`WindowInsets.navigationBars` ≈ 48dp), the in-app tab bar was only 58px tall with 6px bottom pad — so **Chats / Communities / Calls / Settings labels and hit targets sat under the system bar**.

---

## Fix strategy

1. **`mobile/src/lib/safeLayout.ts`** — shared helpers (`tabBarSafeStyle`, `fabBottom`, `bottomInset`, `topInset`). No hardcoded OEM heights.
2. **`MainTabs`** — dynamic `height` / `paddingBottom` from `useSafeAreaInsets().bottom`; `safeAreaInsets: { bottom: 0 }` so React Navigation does not double-pad; `tabBarHideOnKeyboard: true`.
3. Full-screen / modal UIs pad **top** (status bar / cutout) and **bottom** (nav / gesture) from live insets.
4. Sheets / FABs on stack screens use `insets.bottom` (or `fabBottom`).
5. Android theme: `navigationBarColor` + contrast flags so the system bar matches app chrome while content lays out above it via insets.

Insets come from **`react-native-safe-area-context`** (Android `WindowInsetsCompat` / iOS safe area) and update when the user rotates, switches gesture ↔ 3-button nav, or folds the device.

---

## Screen / surface matrix

| Surface | Type | Top inset | Bottom inset | Status |
|---------|------|-----------|--------------|--------|
| **MainTabs** (Chats, Communities, Calls, Settings) | Tab bar | Header via RN | **Dynamic `tabBarSafeStyle`** | ✅ Fixed |
| **Chats** (`ConversationsScreen`) | Tab scene | Stack header | Above tab bar (system inset owned by tabs); FAB above content bottom | ✅ |
| **Communities** | Tab scene | Stack header | Above tab bar | ✅ |
| **Calls** | Tab scene | Stack header | Above tab bar; contact sheet uses `insets.bottom` | ✅ Fixed sheet |
| **Settings** | Tab scene | Stack header | Above tab bar; scroll pad only | ✅ |
| **Chat** (`ChatScreen`) | Stack | Native header | `max(keyboard, insets.bottom)` via Reanimated | ✅ Already correct |
| **Chat sheets** (attach / poll / message menu) | Modal | — | `insets.bottom + n` | ✅ Already correct |
| **Login / Signup / Forgot** (`AuthScreen`) | Stack | `insets.top` | `insets.bottom` on ScrollView | ✅ Already correct |
| **Reset password** | Stack | `insets.top` | `insets.bottom` | ✅ Already correct |
| **New chat** | Stack | Native header | List above safe bottom | ✅ |
| **New group** | Stack | Native header | FAB `fabBottom(insets)` | ✅ Fixed |
| **Group info** | Stack | Native header | Scroll content | ✅ |
| **Join group** | Stack | Native header | Standard stack | ✅ |
| **Profile / Edit profile** | Stack | Native header | Standard stack | ✅ |
| **Appearance / Premium / App lock** | Stack | Native header | Standard stack | ✅ |
| **Privacy / Notifications / Chat settings** | Stack | Native header | Standard stack | ✅ |
| **Storage / Account / Export / Legal / Diagnostics** | Stack | Native header | Standard stack | ✅ |
| **Archived / Starred / Mailbox / Invite** | Stack | Native header | Standard stack | ✅ |
| **Help & Support** | Stack | Native header | Standard stack | ✅ |
| **Streaks / Streak detail / Hall of Legends** | Stack | Native header | Standard stack | ✅ |
| **Admin / Moderator dashboards** | Stack | Native header | List pad | ✅ |
| **Calls detail / Scheduled / Call settings** | Stack | Native header | FAB + sheet use insets | ✅ Fixed |
| **In-call UI** (`CallContext`) | Overlay | Banners | `insets.bottom + 24` controls | ✅ Already correct |
| **Media viewer** | Fullscreen modal | `insets.top` header | `insets.bottom` footer + info sheet | ✅ Fixed |
| **Media picker / preview** | Fullscreen | `insets.top` | `insets.bottom` bars | ✅ Already correct |
| **Media tools** (Crop / Draw / Video / Overlay) | Fullscreen | Dynamic top | Dynamic bottom | ✅ Fixed |
| **Status viewer** | Fullscreen | Progress `insets.top` | Footer `insets.bottom` | ✅ Fixed |
| **Status audience picker** | Modal | Header `insets.top` | Container `insets.bottom` | ✅ Fixed |
| **Emoji picker / Forward sheet** | Modal sheet | — | `insets.bottom` | ✅ Already correct |
| **DialogHost action sheets** | Modal sheet | — | `max(insets.bottom, 10)` | ✅ Already correct |
| **Input modal** | Centered dialog | — | Card centered (not edge-docked) | ✅ N/A edge |
| **App lock screen** | Overlay | `insets.top` | `insets.bottom` | ✅ Fixed |
| **Admin announcement banner** | Overlay | `insets.top + 8` | — | ✅ Already correct |
| **Error boundary fallback** | Full screen | Centered content | Centered | ✅ |

**Result: zero known system-UI overlaps on the audited surfaces.**

---

## Keyboard & orientation

| Case | Behaviour |
|------|-----------|
| Keyboard open (Chat) | Composer lifts with IME height (`useAnimatedKeyboard`); falls back to bottom inset when closed |
| Keyboard open (Auth) | `KeyboardAvoidingView` (iOS) + scroll `paddingBottom: insets.bottom` |
| Tab screens + keyboard | `tabBarHideOnKeyboard: true` |
| Portrait / landscape | Insets re-read from SafeAreaProvider; tab bar height recomputed via `useMemo([insets.bottom, …])` |
| Tablets / foldables | Same inset API; no fixed screen heights for chrome |

---

## OEM coverage (by design)

Uses platform WindowInsets / safe area — not OEM-specific constants:

- 3-button navigation (Samsung, Pixel, OnePlus, Realme, Xiaomi, Vivo, Oppo, Motorola, …)
- Gesture navigation / thin gesture handle
- Display cutout / punch-hole / notch (top inset)
- iOS home indicator

---

## Verification

| Check | Result |
|-------|--------|
| Mobile `tsc --noEmit` | Run after changes |
| Unit tests `safeLayout.test.ts` | Asserts tab bar height/padding derive from insets; rejects old 58/6 and 84/28 hardcodes |
| Manual QA (required on device) | 3-button Android: tab labels fully visible & tappable; gesture nav OK; chat composer above keyboard; media/status chrome clear of system bars |

---

## Files (primary)

- `mobile/src/lib/safeLayout.ts` — helpers  
- `mobile/App.tsx` — MainTabs  
- `mobile/src/components/MediaViewer.tsx`  
- `mobile/src/components/status/StatusViewer.tsx`  
- `mobile/src/components/status/AudiencePicker.tsx`  
- `mobile/src/screens/CallsScreen.tsx`  
- `mobile/src/screens/ScheduledCallsScreen.tsx`  
- `mobile/src/screens/NewGroupScreen.tsx`  
- `mobile/src/security/LockScreen.tsx`  
- `mobile/src/media/tools/*`  
- `mobile/android/app/src/main/res/values/styles.xml`  
- `mobile/src/lib/__tests__/safeLayout.test.ts`  

---

## Sign-off

| Item | Status |
|------|--------|
| Bottom tabs above system nav bar | ✅ |
| No hardcoded bottom chrome heights for system UI | ✅ |
| Dynamic insets | ✅ |
| Fullscreen / sheets / FABs audited | ✅ |
| Chat keyboard path preserved | ✅ |
| Production blocker cleared (code) | ✅ — confirm on physical 3-button device before store ship |
