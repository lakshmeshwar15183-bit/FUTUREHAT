/**
 * Regression: chat last-message ↔ composer gap (WhatsApp layout invariants).
 */
import {
  threadColumnBottomPad,
  invertedListContentPadding,
  composerInnerBottomPad,
  isInvertedAtLatest,
  shouldRepinToLatestOnComposerResize,
  composerHeightChanged,
  composerTrayHeight,
  KEYBOARD_CLOSED_EPSILON_PX,
} from '../chatThreadLayout';

describe('threadColumnBottomPad (manual / iOS)', () => {
  it('uses IME height only when keyboard is open (no double-count with inset)', () => {
    expect(threadColumnBottomPad(320, 34, 'manual')).toBe(320);
    expect(threadColumnBottomPad(300, 0, 'manual')).toBe(300);
  });

  it('uses safe-area only when keyboard is closed', () => {
    expect(threadColumnBottomPad(0, 34, 'manual')).toBe(34);
    expect(threadColumnBottomPad(0, 0, 'manual')).toBe(0);
  });

  it('treats residual IME noise as closed', () => {
    expect(threadColumnBottomPad(KEYBOARD_CLOSED_EPSILON_PX, 34, 'manual')).toBe(34);
    expect(threadColumnBottomPad(1, 20, 'manual')).toBe(20);
  });

  it('never returns Math.max(ime, inset) while IME is clearly open', () => {
    const pad = threadColumnBottomPad(40, 34, 'manual');
    expect(pad).toBe(40);
    expect(pad).not.toBe(40 + 34);
  });
});

describe('threadColumnBottomPad (android-resize)', () => {
  it('returns 0 when OS fully resized the window (shrink ≈ IME)', () => {
    // Classic adjustResize — pad would double-count and create a huge gap.
    expect(threadColumnBottomPad(320, 34, 'android-resize', 320)).toBe(0);
    expect(threadColumnBottomPad(280, 0, 'android-resize', 280)).toBe(0);
    // Near-full shrink within slack still counts as complete.
    expect(threadColumnBottomPad(320, 34, 'android-resize', 315)).toBe(0);
  });

  it('pads residual IME when window did not shrink (edge-to-edge / Realme)', () => {
    // Phone screenshot bug: IME open, window height unchanged → pad full IME.
    expect(threadColumnBottomPad(765, 132, 'android-resize', 0)).toBe(765);
    expect(threadColumnBottomPad(897, 132, 'android-resize', 0)).toBe(897);
    // Partial resize: only lift what the OS did not already exclude.
    expect(threadColumnBottomPad(320, 34, 'android-resize', 100)).toBe(220);
  });

  it('uses safe-area only when keyboard is closed', () => {
    expect(threadColumnBottomPad(0, 34, 'android-resize', 0)).toBe(34);
    expect(threadColumnBottomPad(0, 0, 'android-resize', 50)).toBe(0);
  });

  it('treats residual IME noise as closed', () => {
    expect(threadColumnBottomPad(1, 24, 'android-resize', 0)).toBe(24);
  });

  it('legacy call without shrink arg still pads full IME (safe default)', () => {
    // Missing 4th arg → shrink 0 → residual = IME (never under the keyboard).
    expect(threadColumnBottomPad(320, 34, 'android-resize')).toBe(320);
  });
});

describe('composerTrayHeight', () => {
  it('matches last keyboard height within bounds', () => {
    expect(composerTrayHeight(300, 800)).toBe(300);
  });

  it('falls back on tiny/zero keyboard height', () => {
    const h = composerTrayHeight(0, 800);
    expect(h).toBeGreaterThanOrEqual(240);
  });
});

describe('invertedListContentPadding', () => {
  it('keeps near-composer padding tiny so last bubble hugs input', () => {
    const p = invertedListContentPadding();
    expect(p.paddingTop).toBeLessThanOrEqual(4);
    expect(p.paddingBottom).toBeGreaterThanOrEqual(p.paddingTop);
  });

  it('maps paddingTop to near-composer (inverted contract)', () => {
    const p = invertedListContentPadding({ nearComposerPx: 2, nearTopPx: 10 });
    expect(p.paddingTop).toBe(2);
    expect(p.paddingBottom).toBe(10);
  });
});

describe('composerInnerBottomPad', () => {
  it('is chrome-only and does not embed a second safe-area', () => {
    expect(composerInnerBottomPad()).toBe(6);
    expect(composerInnerBottomPad()).toBeLessThan(20);
  });
});

describe('isInvertedAtLatest', () => {
  it('treats offset 0 as latest', () => {
    expect(isInvertedAtLatest(0)).toBe(true);
  });

  it('uses tight slack so a 100px gap is NOT “at latest”', () => {
    expect(isInvertedAtLatest(100)).toBe(false);
    expect(isInvertedAtLatest(10)).toBe(true);
    expect(isInvertedAtLatest(20)).toBe(false);
  });
});

describe('composer resize re-pin', () => {
  it('re-pins only when following latest', () => {
    expect(shouldRepinToLatestOnComposerResize(true)).toBe(true);
    expect(shouldRepinToLatestOnComposerResize(false)).toBe(false);
  });

  it('ignores sub-pixel height noise', () => {
    expect(composerHeightChanged(56, 56.4)).toBe(false);
    expect(composerHeightChanged(56, 72)).toBe(true);
  });
});

describe('source contract: ChatScreen must not reintroduce gap bugs', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../screens/ChatScreen.tsx'),
    'utf8',
  );

  it('uses threadColumnBottomPad with android-resize on Android', () => {
    expect(src).toMatch(/threadColumnBottomPad/);
    expect(src).toMatch(/android-resize/);
    // Must not reintroduce Math.max(ime, inset).
    expect(src).not.toMatch(/Math\.max\(\s*keyboard\.height/);
    expect(src).not.toMatch(/useAnimatedKeyboard/);
    expect(src).toMatch(/keyboardDidShow|keyboardWillShow/);
  });

  it('paints an opaque chat canvas (no Main tab bleed-through)', () => {
    expect(src).toMatch(/chatCanvasBg|EFEAE2/);
    expect(src).toMatch(/collapsable=\{false\}/);
    expect(src).toMatch(/backgroundColor: chatCanvasBg/);
  });

  it('uses white header chrome on green header', () => {
    expect(src).toMatch(/headerOnGreen/);
    expect(src).toMatch(/headerTitle:[\s\S]*?#FFFFFF/);
  });

  it('gives FlatList explicit flex:1 list style', () => {
    expect(src).toMatch(/styles\.list/);
    expect(src).toMatch(/list:\s*\{\s*flex:\s*1\s*\}/);
  });

  it('does not enable removeClippedSubviews on inverted chat list', () => {
    expect(src).toMatch(/removeClippedSubviews=\{false\}/);
  });

  it('re-pins on composer layout and keyboard hide', () => {
    expect(src).toMatch(/onComposerLayout/);
    expect(src).toMatch(/keyboardWillHide|keyboardDidHide/);
    expect(src).toMatch(/isInvertedAtLatest/);
  });

  it('never flexGrow:1 content container (inverted gap source)', () => {
    expect(src).not.toMatch(/listContent:[^}]*flexGrow:\s*1/);
    expect(src).toMatch(/flexGrow:\s*0/);
  });
});
