/**
 * Sticky bottom action bar that always clears the system navigation bar.
 *
 * Use for Next / Continue / Save / Create / Send footers that sit at the
 * bottom of a screen (outside the scroll view). Live WindowInsets drive
 * paddingBottom — gesture, 2-button, and 3-button nav all work without
 * hard-coded dp values or app restart when the user switches modes.
 *
 * Pair with SafeScrollView for the scrollable body so the last field can
 * still scroll above this bar + the system inset.
 */
import React, { type ReactNode } from 'react';
import {
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import {
  useFooterBottomPad,
  useSafeBottomBarStyle,
} from '../lib/safeLayoutHooks';

export type SafeBottomBarProps = ViewProps & {
  children: ReactNode;
  /**
   * Extra chrome pad above the system inset (button breathing room).
   * Default 12. Never replaces the system inset itself.
   */
  extra?: number;
  style?: StyleProp<ViewStyle>;
};

/** Re-export hook for one-import convenience. */
export { useSafeBottomBarStyle };

export default function SafeBottomBar({
  children,
  extra = 12,
  style,
  ...rest
}: SafeBottomBarProps) {
  const paddingBottom = useFooterBottomPad(extra);
  return (
    <View style={[{ paddingBottom }, style]} {...rest}>
      {children}
    </View>
  );
}
