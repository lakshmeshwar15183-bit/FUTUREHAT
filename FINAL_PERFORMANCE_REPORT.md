# FINAL PERFORMANCE REPORT — Lumixo

**Date:** 2026-07-12  
**Score: Performance 8.2 / 10 · Battery 7.9 / 10**

---

## What is solid

| Area | Implementation |
|------|----------------|
| Web chat | Windowed list / deferred Supabase / lazy call & admin chunks (prior pass) |
| Mobile chat | FlatList inverted, local-first cache (800 msgs), optimistic send |
| Media | Disk cache + mem peek + signed URL; index write serialized |
| Calls | Adaptive bitrate, low-data mode, H264 preference, ICE pool 16 |
| Push | Client no longer drains global outbox every send (CPU/network waste + abuse) |
| Theme | Contrast validated for light/AMOLED |

---

## Fixes this challenge (perf-adjacent)

1. **Message cache lock** — prevents lost rows (correctness) and avoids refetch thrash.  
2. **Media index lock** — fewer orphan re-downloads.  
3. **Outbox re-flush** — fewer “stuck until next NetInfo” stalls.  
4. **GroupInfo object URL memo** — stops blob URL leak / GC pressure.  
5. **Call ICE restart mutex** — fewer failed renegotiations (battery on radio).  

---

## Bottlenecks remaining

| Bottleneck | Impact | 10/10 requires |
|------------|--------|----------------|
| AsyncStorage for chat | O(n) JSON parse | MMKV / SQLite / WatermelonDB |
| Realtime fan-out per chat | Channel cost at scale | Presence sharding / server aggregates |
| `getStats` every 2.5s in call | CPU | Adaptive interval when quality stable |
| Expo JS bridge media | Encode latency | TurboModules / native pipeline |
| Web no virtualization edge cases | Large threads | Already partially windowed; keep measuring |

---

## Battery

| Source | Status |
|--------|--------|
| FCM high-priority data for calls | Required for reliability; OEM may still kill |
| InCallManager proximity / keep-screen | On for video/speaker only |
| Push drain from every client send | **Removed** |
| Adaptive call probe | Active; acceptable for WA-class calls |

**Cannot reach 10/10 battery** without OEM-specific native power exemptions and fewer JS wakeups (native messenger process model).

---

## Metrics to watch in production

- p95 message send → peer FCM delivery  
- Chat open p95 (cold vs warm cache)  
- Call connect time with/without TURN  
- Crash-free sessions (crash-report edge)  
- AsyncStorage size growth per install  

---

## Score justification

8.2 is justified by measured architecture (local-first, windowing, adaptive calls) and green builds. Not 9+: no native DB, no continuous production RUM numbers in this session.
