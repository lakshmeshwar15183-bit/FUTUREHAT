/**
 * Safe-area layout helpers — pure unit tests (no RN runtime).
 */
import {
  TAB_BAR_CONTENT_HEIGHT,
  MIN_BOTTOM_PAD,
  bottomInset,
  topInset,
  fabBottom,
  tabBarSafeStyle,
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
