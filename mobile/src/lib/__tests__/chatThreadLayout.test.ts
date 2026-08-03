/**
 * Regression: chat last-message ↔ composer gap (WhatsApp layout invariants).
 */
import {
  threadColumnBottomPad,
  chatBottomSpacer,
  imeHeightFromEvent,
  invertedListContentPadding,
  composerInnerBottomPad,
  isInvertedAtLatest,
  shouldRepinToLatestOnComposerResize,
  composerHeightChanged,
  composerTrayHeight,
  KEYBOARD_CLOSED_EPSILON_PX,
} from '../chatThreadLayout';

describe('chatBottomSpacer (WhatsApp IME + nav)', () => {
  it('uses full IME height when keyboard is open (covers nav under keyboard)', () => {
    expect(chatBottomSpacer(765, 132, 0)).toBe(765);
    expect(chatBottomSpacer(320, 34, 280)).toBe(320);
  });

  it('uses tray height when IME closed and tray open', () => {
    expect(chatBottomSpacer(0, 132, 300)).toBe(300);
  });

  it('uses safe-area only when both IME and tray closed', () => {
    expect(chatBottomSpacer(0, 48, 0)).toBe(48);
    expect(chatBottomSpacer(1, 48, 0)).toBe(48); // residual noise
  });

  it('never double-counts IME + inset', () => {
    const pad = chatBottomSpacer(300, 48, 0);
    expect(pad).toBe(300);
    expect(pad).not.toBe(348);
  });
});

describe('imeHeightFromEvent (edge-to-edge)', () => {
  it('prefers screenY distance to bottom of screen', () => {
    // Realme: screen 2412, keyboard top at 1515 → 897
    expect(imeHeightFromEvent({ height: 765, screenY: 1515 }, 2412)).toBe(897);
  });

  it('falls back to height when screenY missing', () => {
    expect(imeHeightFromEvent({ height: 320 }, 800)).toBe(320);
  });

  it('returns 0 when keyboard closed', () => {
    expect(imeHeightFromEvent({ height: 0, screenY: 2412 }, 2412)).toBe(0);
    expect(imeHeightFromEvent(null, 2412)).toBe(0);
  });
});

describe('threadColumnBottomPad (manual / iOS legacy)', () => {
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
});

describe('threadColumnBottomPad (android-resize legacy)', () => {
  it('returns 0 when OS fully resized the window (shrink ≈ IME)', () => {
    expect(threadColumnBottomPad(320, 34, 'android-resize', 320)).toBe(0);
    expect(threadColumnBottomPad(280, 0, 'android-resize', 280)).toBe(0);
  });

  it('pads residual IME when window did not shrink', () => {
    expect(threadColumnBottomPad(765, 132, 'android-resize', 0)).toBe(765);
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

describe('source contract: ChatScreen WhatsApp keyboard', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../screens/ChatScreen.tsx'),
    'utf8',
  );

  it('uses keyboard-controller IME animation + chatBottomSpacer', () => {
    expect(src).toMatch(/useReanimatedKeyboardAnimation/);
    expect(src).toMatch(/chatBottomSpacer/);
    expect(src).toMatch(/react-native-keyboard-controller/);
    expect(src).not.toMatch(/useAnimatedKeyboard/);
    expect(src).not.toMatch(/android-resize/);
  });

  it('has bottom IME spacer (not only paddingBottom on root)', () => {
    expect(src).toMatch(/imeSpacerStyle/);
    expect(src).toMatch(/Animated\.View/);
  });

  it('paints an opaque chat canvas (no Main tab bleed-through)', () => {
    expect(src).toMatch(/chatCanvasBg|EFEAE2/);
    expect(src).toMatch(/collapsable=\{false\}/);
    expect(src).toMatch(/backgroundColor: chatCanvasBg/);
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
    expect(src).toMatch(/keyboardWillHide|keyboardDidHide|useKeyboardHandler/);
    expect(src).toMatch(/isInvertedAtLatest/);
  });

  it('never flexGrow:1 content container (inverted gap source)', () => {
    expect(src).not.toMatch(/listContent:[^}]*flexGrow:\s*1/);
    expect(src).toMatch(/flexGrow:\s*0/);
  });
});
