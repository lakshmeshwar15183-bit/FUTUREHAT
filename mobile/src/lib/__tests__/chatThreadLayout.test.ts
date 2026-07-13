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
  KEYBOARD_CLOSED_EPSILON_PX,
} from '../chatThreadLayout';

describe('threadColumnBottomPad', () => {
  it('uses IME height only when keyboard is open (no double-count with inset)', () => {
    expect(threadColumnBottomPad(320, 34)).toBe(320);
    expect(threadColumnBottomPad(300, 0)).toBe(300);
  });

  it('uses safe-area only when keyboard is closed', () => {
    expect(threadColumnBottomPad(0, 34)).toBe(34);
    expect(threadColumnBottomPad(0, 0)).toBe(0);
  });

  it('treats residual IME noise as closed', () => {
    expect(threadColumnBottomPad(KEYBOARD_CLOSED_EPSILON_PX, 34)).toBe(34);
    expect(threadColumnBottomPad(1, 20)).toBe(20);
  });

  it('never returns Math.max(ime, inset) while IME is clearly open', () => {
    // Historical bug: Math.max(300, 34) is fine, but Math.max(40, 34) when 40
    // is a partial IME + inset double-count left a phantom band.
    const pad = threadColumnBottomPad(40, 34);
    expect(pad).toBe(40);
    expect(pad).not.toBe(40 + 34);
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
    // Old code used < 240 which allowed a large empty band.
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

  it('keyboard pad is worklet-safe (no Math.max keyboard/inset double-count)', () => {
    // Must not reintroduce Math.max(ime, inset) which leaves a blank band on OEMs.
    expect(src).not.toMatch(/Math\.max\(\s*keyboard\.height/);
    // Pad rule must run inside a worklet with pure math (no JS helper call).
    expect(src).toMatch(/useAnimatedStyle/);
    expect(src).toMatch(/'worklet'/);
    expect(src).toMatch(/kb > 2/);
  });

  it('gives FlatList explicit flex:1 list style', () => {
    expect(src).toMatch(/style=\{styles\.list\}/);
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
    // listContent may set flexGrow: 0 explicitly; must not be 1.
    expect(src).not.toMatch(/listContent:[^}]*flexGrow:\s*1/);
    expect(src).toMatch(/flexGrow:\s*0/);
  });
});
