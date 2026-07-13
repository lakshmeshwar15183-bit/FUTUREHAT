/**
 * ScrollView that always respects the live system navigation-bar inset.
 *
 * Use this for stack / modal / full-screen scrollable content so the last
 * button, row, or field never sits under 3-button / gesture / 2-button bars.
 *
 * For tab-root screens whose content already ends above the in-app tab bar
 * (which itself owns the system inset via tabBarSafeStyle), pass
 * `includeBottomInset={false}` to avoid double-padding.
 *
 * Insets update live when the user changes navigation mode — no restart.
 */
import React, { forwardRef, useMemo } from 'react';
import {
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEFAULT_SCROLL_EXTRA,
  mergeScrollBottomPad,
  scrollBottomPad,
} from '../lib/safeLayout';

export type SafeScrollViewProps = ScrollViewProps & {
  /**
   * Extra content padding above the system bottom inset.
   * Default: DEFAULT_SCROLL_EXTRA (24).
   */
  bottomExtra?: number;
  /**
   * When true (default), add system navigation-bar inset to content bottom.
   * Set false for tab-root lists already above a safe tab bar.
   */
  includeBottomInset?: boolean;
};

const SafeScrollView = forwardRef<ScrollView, SafeScrollViewProps>(
  function SafeScrollView(
    {
      contentContainerStyle,
      bottomExtra = DEFAULT_SCROLL_EXTRA,
      includeBottomInset = true,
      keyboardShouldPersistTaps = 'handled',
      ...rest
    },
    ref,
  ) {
    const insets = useSafeAreaInsets();
    const mergedContentStyle = useMemo(() => {
      if (!includeBottomInset) return contentContainerStyle;
      const pad = scrollBottomPad(insets, bottomExtra);
      return mergeScrollBottomPad(
        contentContainerStyle,
        pad,
      ) as StyleProp<ViewStyle>;
    }, [contentContainerStyle, includeBottomInset, insets.bottom, bottomExtra]);

    return (
      <ScrollView
        ref={ref}
        contentContainerStyle={mergedContentStyle}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        {...rest}
      />
    );
  },
);

export default SafeScrollView;
