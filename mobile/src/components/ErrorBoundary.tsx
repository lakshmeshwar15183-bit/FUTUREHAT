// FUTUREHAT — generic React error boundary. Without one, ANY exception thrown
// while rendering a screen unmounts the whole React tree and leaves a BLANK
// screen (the reported "chat randomly goes blank" bug: an intermittent render
// throw in the message list / a modal / a bubble had nothing to catch it). This
// boundary catches the throw, keeps the app mounted, shows a recoverable
// fallback, and logs the real error so the underlying cause can be diagnosed.

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors, spacing, radius, font, type Palette } from '../theme';

interface Props {
  children: React.ReactNode;
  /** Optional label so logs identify which boundary tripped. */
  label?: string;
  /** Optional custom fallback renderer. */
  fallback?: (reset: () => void) => React.ReactNode;
}
interface State { error: Error | null }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surfaced in Metro / device logs and any crash reporter — this is where the
    // ACTUAL cause of a blank screen becomes visible for follow-up fixes.
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.reset);
      return <DefaultFallback onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.wrap}>
      <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>This screen hit an unexpected error. Your messages are safe.</Text>
      <Pressable style={styles.btn} onPress={onRetry}>
        <Text style={styles.btnText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(6), backgroundColor: colors.bg },
    title: { color: colors.text, fontSize: font.heading, fontWeight: '700', marginTop: spacing(4) },
    body: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', marginTop: 6, marginBottom: spacing(6) },
    btn: { backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 11, borderRadius: radius.md },
    btnText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
  });
