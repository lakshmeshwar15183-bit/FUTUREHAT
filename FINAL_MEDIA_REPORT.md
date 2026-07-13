# FINAL MEDIA REPORT — Lumixo

**Date:** 2026-07-12  
**Score: Media 8.3 / 10**

---

## Pipeline

| Stage | Behavior |
|-------|----------|
| Capture / pick | Expo media picker + preview |
| Offline send | Outbox holds `localUri`; upload on flush |
| Storage | Private `media` bucket + membership policies |
| Display | Signed URLs (web + mobile hooks) |
| Cache | Disk index + memory peek; **write lock** (this pass) |
| View Once | Server consume then open; fail closed |
| Stickers | Now **outbox-backed** (was online-only) |

---

## Security / correctness fixes

1. **safeHref** on GroupInfo + ContactProfile media links  
2. **useSignedUrl** blocks non-http(s) non-image-data schemes  
3. **mediaCache index serialization** — concurrent downloads no longer drop index entries  
4. **Sticker send** uses durable outbox  

---

## Limits

| Limit | Note |
|-------|------|
| Free upload 5 MB / premium 100 MB | Product tiers |
| No streaming transcode server | Client encodes; large video flaky on weak devices |
| GIF/video memory | Viewer math unit-tested; huge assets still risk OOM |
| Web object URLs | Group icon leak fixed; other pickers should follow pattern |

---

## Why not 10/10

WhatsApp uses multi-CDN, aggressive adaptive compression, streaming upload, and platform-native photo stacks. Lumixo is solid **signed private media + offline queue** without a media processing farm.
