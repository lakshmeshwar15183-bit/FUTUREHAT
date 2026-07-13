/**
 * FlatList that always respects the live system navigation-bar inset.
 * Same contract as SafeScrollView — last row never sits under 3-button /
 * gesture / 2-button navigation.
 */
import React, { forwardRef, useMemo } from 'react';
import {
  FlatList,
  type FlatListProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEFAULT_SCROLL_EXTRA,
  mergeScrollBottomPad,
  scrollBottomPad,
} from '../lib/safeLayout';

export type SafeFlatListProps<ItemT> = FlatListProps<ItemT> & {
  bottomExtra?: number;
  includeBottomInset?: boolean;
};

function SafeFlatListInner<ItemT>(
  {
    contentContainerStyle,
    bottomExtra = DEFAULT_SCROLL_EXTRA,
    includeBottomInset = true,
    ...rest
  }: SafeFlatListProps<ItemT>,
  ref: React.ForwardedRef<FlatList<ItemT>>,
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
    <FlatList
      ref={ref}
      contentContainerStyle={mergedContentStyle}
      {...rest}
    />
  );
}

const SafeFlatList = forwardRef(SafeFlatListInner) as <ItemT>(
  props: SafeFlatListProps<ItemT> & { ref?: React.ForwardedRef<FlatList<ItemT>> },
) => React.ReactElement | null;

export default SafeFlatList;
