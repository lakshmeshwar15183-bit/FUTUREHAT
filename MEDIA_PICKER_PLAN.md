# FUTUREHAT — Production Media Picker & Editor: Implementation Plan

Redesign the mobile attachment flow into a WhatsApp-class full-screen picker +
editor, keeping FUTUREHAT branding. **Mobile-full / web-graceful-subset**, built in
**testable phases**. Grounded in the real repo (send pipeline, outbox, upload limits,
theme, `messages` schema).

## Hard constraints (read first)
- The app builds from a **committed native `android/` dir + keystore**; adding native
  modules requires `expo prebuild` + a Gradle/Xcode build **I cannot compile or run
  here** (no SDK/Xcode/device). So native-dependent parts are **code-complete +
  typecheck-clean**, but *device-build verification is yours*. I label every such part.
- **Web cannot run** Skia/FFMPEG/native-albums → web gets a graceful subset only.
- `messages.type` has no `video`; videos ride as `image`/`file` + `media_url` (same as
  today). No schema break.

## Current architecture (reused, not duplicated)
- Attach entry: `ChatScreen.tsx` bottom-sheet `Modal` (`attachOpen`) → `pickImage()` →
  `sendMedia(uri,name,type,caption)` → `uploadMediaFromUri` (`lib/media.ts`) →
  `sendMessage(type, media_url)`.
- Upload gating: `withinUploadLimit()` (FREE/PREMIUM_LIMITS).
- Theme: `useColors/spacing/radius/font`; nav: `RootStackParamList` + `App.tsx` stack.
- Stickers: `lib/stickers.ts` (SVG data-URIs). Offline: outbox/action-queue in
  `lib/localCache.ts` + `lib/sync.ts`.

---

## PHASE A — Picker + Preview + Caption + Options  (buildable, tsc-verifiable)
Libraries added: **`expo-media-library`** (albums/enumeration), **`expo-image`**
(fast cached thumbnails; already a dep). No Skia/FFMPEG yet → still needs a device
build to *run*, but no exotic native code; tsc + logic are verifiable here.

Files (new):
- `mobile/src/screens/MediaPickerScreen.tsx` — full-screen picker: `Recent ▼` album
  switcher (MediaLibrary.getAlbumsAsync), virtualized `FlatList` grid (numColumns=3/4,
  `getItemLayout`, windowing), infinite scroll (`getAssetsAsync` paged by `after`),
  newest-first, `expo-image` thumbnails (memory/disk cache), multi-select with **yellow
  numbered circles** preserving selection order, configurable `maxSelection`, tap-to-
  deselect, reanimated selection scale. Camera tile. Loading/empty/permission states.
- `mobile/src/screens/MediaPreviewScreen.tsx` — per-asset editor shell: top bar
  (Close · Download · HD toggle · Crop · Sticker · Text · Draw · Undo · Redo — tools
  that need Phase B are present but disabled-with-tooltip until their module lands),
  swipeable multi-asset strip, bottom caption bar (large field, emoji, mention `@`,
  char counter, future location/schedule stubs), **Send** / **View Once** control,
  per-asset HD + quality (Standard/HD/Original) with estimated size.
- `mobile/src/media/MediaEditorContext.tsx` — per-asset edit state (caption, quality,
  viewOnce, crop rect, layers[]) so switching assets preserves edits.
- `mobile/src/media/qualityEstimate.ts` — size estimate from dimensions×quality.
- Wire into `ChatScreen`: replace the Photo/Video sheet row → `navigation.navigate
  ('MediaPicker', {conversationId})`. Keep Document/Camera/Location/Poll rows. On
  confirm, picker→preview→`onSend(assets[])` calls the **existing** `sendMedia` per
  asset (loop), reusing upload + outbox. Backward compatible.
- Register `MediaPicker` + `MediaPreview` in `navigation/types.ts` + `App.tsx`.

DB (small, additive, idempotent) — `supabase/migrations/0030_media_extras.sql`:
- `alter table messages add column if not exists media_meta jsonb not null default
  '{}'` — carries `{viewOnce, hd, quality, width, height, durationMs}`. No type change,
  fully backward-compatible (old rows = `{}`).
- `message_view_once_views(message_id, viewer_id, viewed_at)` + RPC `mark_view_once
  _seen` so a View-Once opens exactly once per recipient (server-authoritative). RLS:
  members read; own view insert.
- Extend `shared/types.ts` `Message` with optional `media_meta`; `shared/api.ts`
  `sendMessage` accepts optional `mediaMeta`.

View Once (Phase A): onboarding dialog once (AsyncStorage `fh:viewonce:ack`), send-
button swap, `media_meta.viewOnce=true`, receiver-side one-open enforced by the RPC +
`MessageBubble` gating. (Screenshot *blocking* needs native `FLAG_SECURE`/Phase B; the
one-view + no-forward/save rules are enforceable now — I'll flag screenshot-block as
native-pending.)

## PHASE B — Editor tools  (code written; REQUIRES your device build)
Libraries: **`expo-image-manipulator`** (crop/rotate/flip/resize export),
**`@shopify/react-native-skia`** (draw/blur/neon + text-layer render),
**`@georstat/react-native-image-crop-picker`**? no — stay Expo-native.
- `mobile/src/media/tools/CropTool.tsx` — free + 1:1/16:9/9:16/4:3, rotate, flip,
  pinch-zoom/pan (gesture-handler + reanimated), export via image-manipulator.
- `mobile/src/media/tools/DrawTool.tsx` — Skia canvas: pen/highlighter/neon/arrow/
  blur/eraser, color picker, stroke slider, undo/redo stack.
- `mobile/src/media/tools/TextTool.tsx` — multi-layer text: fonts, bold/italic, bg,
  align, rotate/resize/drag (gestures), opacity.
- `mobile/src/media/tools/StickerTool.tsx` — emoji + FUTUREHAT stickers (reuse
  `lib/stickers.ts`) + **GIF** (needs a GIF source/lib — flagged) + search + recent +
  favorites. Composite layers → flatten to a new URI on send (Skia snapshot).

## PHASE C — Video editor  (needs FFMPEG native; FLAGGED, not silently shipped)
- Trim/mute/compress need `ffmpeg-kit-react-native` (heavy native, licensing note) or
  `react-native-video-trim`. Thumbnail selection via `expo-video-thumbnails`.
- I will implement the **UI + integration seam** and clearly mark the transcode calls
  as requiring the native module + your build; I will NOT fake compression.

## Web (graceful subset) — no regression
- `web/src/media/MediaComposer.tsx` — multi-file `<input>`, grid preview, caption +
  emoji + quality (Standard/HD/Original via canvas re-encode), View Once flag. Reuses
  the web upload path. Native-only tools (draw/crop/trim) simply absent. Existing web
  media flow untouched otherwise.

## Removal (per spec §16)
- Delete the Photo/Video **bottom-sheet gallery path** in `ChatScreen` (the
  `AttachOption "Photo / Video"` → old `pickImage(false)` library launch). Camera stays.
  Old `pickImage(true)` camera + `pickDocument` preserved. No message/upload regression.

## Testing (per spec §8) — honest matrix
- `tsc --noEmit` (mobile) + `web build` after **each phase** — the automatable gate.
- Logic units where pure (quality estimate, selection-order, view-once RPC via live DB
  like the streak harness).
- **Cannot** run device UI/scroll-FPS/native-editor tests here → those are handed to
  you with a written per-workflow checklist. I will NOT mark native-dependent workflows
  "tested".

## Deliverables per phase
Each phase ends with: files changed, libs added (+ why a rebuild is needed), what I
verified vs what needs your device build, and any flagged/native-pending item.
