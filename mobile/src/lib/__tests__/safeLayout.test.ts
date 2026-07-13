/**
 * Safe-area layout helpers — pure unit tests (no RN runtime).
 */
import {
  TAB_BAR_CONTENT_HEIGHT,
  MIN_BOTTOM_PAD,
  DEFAULT_SCROLL_EXTRA,
  DEFAULT_SHEET_EXTRA,
  bottomInset,
  topInset,
  fabBottom,
  tabBarSafeStyle,
  scrollBottomPad,
  sheetBottomPad,
  footerBottomPad,
  dialogVerticalPad,
  mergeScrollBottomPad,
} from '../safeLayout';

describe('bottomInset / topInset', () => {
  it('returns system bottom inset when present', () => {
    expect(bottomInset({ bottom: 48 })).toBe(48);
  });

  it('respects min floor', () => {
    expect(bottomInset({ bottom: 0 }, 8)).toBe(8);
    expect(bottomInset({ bottom: 12 }, 8)).toBe(12);
  });

  it('returns system top inset', () => {
    expect(topInset({ top: 44 })).toBe(44);
    expect(topInset({ top: 0 }, 12)).toBe(12);
  });
});

describe('fabBottom', () => {
  it('includes system inset by default', () => {
    expect(fabBottom({ bottom: 48 }, { extra: 16 })).toBe(64);
  });

  it('can ignore system inset when tab bar already owns it', () => {
    expect(fabBottom({ bottom: 48 }, { extra: 20, includeSystem: false })).toBe(20);
  });
});

describe('tabBarSafeStyle', () => {
  it('adds bottom inset into height and paddingBottom', () => {
    const style = tabBarSafeStyle({ bottom: 48 }, { backgroundColor: '#111' });
    expect(style.paddingBottom).toBe(48);
    expect(style.height).toBe(TAB_BAR_CONTENT_HEIGHT + 48);
    expect(style.backgroundColor).toBe('#111');
  });

  it('uses MIN_BOTTOM_PAD when system inset is 0', () => {
    const style = tabBarSafeStyle({ bottom: 0 });
    expect(style.paddingBottom).toBe(MIN_BOTTOM_PAD);
    expect(style.height).toBe(TAB_BAR_CONTENT_HEIGHT + MIN_BOTTOM_PAD);
  });

  it('never uses hardcoded Android 58/6 or iOS 84/28', () => {
    const a = tabBarSafeStyle({ bottom: 48 });
    const b = tabBarSafeStyle({ bottom: 0 });
    expect(a.height).not.toBe(58);
    expect(a.paddingBottom).not.toBe(6);
    expect(b.height).not.toBe(84);
    expect(b.paddingBottom).not.toBe(28);
  });
});

describe('scrollBottomPad', () => {
  it('adds system inset + extra', () => {
    expect(scrollBottomPad({ bottom: 48 }, 24)).toBe(72);
    expect(scrollBottomPad({ bottom: 0 }, DEFAULT_SCROLL_EXTRA)).toBe(DEFAULT_SCROLL_EXTRA);
  });

  it('uses live 3-button height (not a constant)', () => {
    expect(scrollBottomPad({ bottom: 48 })).toBe(48 + DEFAULT_SCROLL_EXTRA);
    expect(scrollBottomPad({ bottom: 16 })).toBe(16 + DEFAULT_SCROLL_EXTRA);
  });
});

describe('sheetBottomPad', () => {
  it('floors at MIN_BOTTOM_PAD + extra', () => {
    expect(sheetBottomPad({ bottom: 0 }, 12)).toBe(MIN_BOTTOM_PAD + 12);
    expect(sheetBottomPad({ bottom: 48 }, DEFAULT_SHEET_EXTRA)).toBe(48 + DEFAULT_SHEET_EXTRA);
  });
});

describe('footerBottomPad', () => {
  it('sums live system inset and extra (3-button / gesture)', () => {
    expect(footerBottomPad({ bottom: 48 }, 12)).toBe(60);
    expect(footerBottomPad({ bottom: 16 }, 12)).toBe(28);
    expect(footerBottomPad({ bottom: 0 }, 12)).toBe(12);
  });

  it('never uses hard-coded Android 3-button height constants', () => {
    // 48 is a realistic 3-button inset, not a magic constant baked into helpers.
    expect(footerBottomPad({ bottom: 48 }, 0)).toBe(48);
    expect(footerBottomPad({ bottom: 0 }, 0)).toBe(0);
  });
});

describe('dialogVerticalPad', () => {
  it('uses top and bottom system insets with min floor', () => {
    expect(dialogVerticalPad({ top: 44, bottom: 48 }, 16)).toEqual({
      paddingTop: 44,
      paddingBottom: 48,
    });
    expect(dialogVerticalPad({ top: 0, bottom: 0 }, 16)).toEqual({
      paddingTop: 16,
      paddingBottom: 16,
    });
  });
});

describe('mergeScrollBottomPad', () => {
  it('creates style when none provided', () => {
    expect(mergeScrollBottomPad(undefined, 40)).toEqual({ paddingBottom: 40 });
  });

  it('merges into object keeping the larger paddingBottom', () => {
    expect(mergeScrollBottomPad({ padding: 16, paddingBottom: 20 }, 48)).toEqual({
      padding: 16,
      paddingBottom: 48,
    });
    expect(mergeScrollBottomPad({ paddingBottom: 80 }, 48)).toEqual({
      paddingBottom: 80,
    });
  });

  it('appends to arrays', () => {
    expect(mergeScrollBottomPad([{ padding: 8 }], 40)).toEqual([
      { padding: 8 },
      { paddingBottom: 40 },
    ]);
  });
});
