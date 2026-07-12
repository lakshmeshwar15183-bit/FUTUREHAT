# Lumixo Cat Mascot — Integration Report

**Version:** 4.6.1  
**Character:** Lumi (official Lumixo mascot)  
**Scope:** UI/animation only — auth APIs & Supabase unchanged  

## Platforms
- Web: SVG + CSS transforms (`web/src/mascot/LumixoCat.tsx`)
- Mobile: Reanimated Views (`mobile/src/components/LumixoCat.tsx`)
- Shared moods: `shared/lumixoCat.ts`

## Behaviours
| State | Mood | Animation |
|-------|------|-----------|
| Default | idle | Breath, blink, slow tail |
| Email focus / typing | watching | Eyes track gaze, ear alert, active tail |
| Password focus | hiding | Paws cover eyes (never peek) |
| Wrong password | confused | Head tilt/shake 2s |
| Success | celebrating | Bounce + tail wag |

## Accessibility
- `prefers-reduced-motion` / system Reduce Motion freezes loops
- Decorative on login (aria-hidden / no-hide-descendants)
- Keyboard & form flows unchanged

## Performance (design targets)
| Metric | Target | Approach |
|--------|--------|----------|
| FPS | 60 | transform/opacity only |
| Auth API | zero change | same signIn/signUp helpers |
| Bundle | light | no framer-motion on web cat; no new native deps on mobile |
| Memory | stable | timers cleaned on unmount; Reanimated cancelAnimation |

## Auth integrity
- `signInWithEmail` / `signUpWithEmail` / `resetPasswordForEmail` unchanged
- No Supabase client changes

## Version
- Android: versionName **4.6.1**, versionCode **61**
