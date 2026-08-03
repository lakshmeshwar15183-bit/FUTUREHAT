// Lumixo mobile — Razorpay Standard Checkout via WebView.
//
// KEY_SECRET never ships to the app. Checkout uses only:
//   • key_id (public) returned by the Edge Function with the Order
//   • order_id created server-side
// On success, payment ids + signature are posted to the WebView bridge and
// verified by the payments-razorpay Edge Function before premium is granted.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { useColors, spacing, radius, font, type Palette } from '../theme';

export interface RazorpayCheckoutParams {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  planLabel: string;
  name?: string;
  email?: string;
  description?: string;
}

export type RazorpayCheckoutOutcome =
  | {
      type: 'success';
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    }
  | { type: 'failed'; description: string; code?: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

interface Props {
  visible: boolean;
  params: RazorpayCheckoutParams | null;
  onResult: (result: RazorpayCheckoutOutcome) => void;
}

function buildCheckoutHtml(p: RazorpayCheckoutParams): string {
  const safe = (s: string) =>
    JSON.stringify(s ?? '').replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    html, body { margin: 0; padding: 0; background: #0b141a; color: #e9edef;
      font-family: -apple-system, system-ui, sans-serif; }
    .wrap { min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 24px; text-align: center; }
    .spin { width: 28px; height: 28px; border: 3px solid #233138; border-top-color: #00a884;
      border-radius: 50%; animation: r 0.8s linear infinite; margin-bottom: 16px; }
    @keyframes r { to { transform: rotate(360deg); } }
    p { opacity: 0.85; font-size: 15px; line-height: 1.4; }
  </style>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body>
  <div class="wrap">
    <div class="spin" id="spin"></div>
    <p id="msg">Opening secure checkout…</p>
  </div>
  <script>
    (function () {
      function post(payload) {
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          }
        } catch (e) {}
      }

      function openCheckout() {
        if (typeof Razorpay === 'undefined') {
          post({ type: 'error', message: 'Could not load Razorpay Checkout' });
          return;
        }
        var options = {
          key: ${safe(p.keyId)},
          order_id: ${safe(p.orderId)},
          amount: ${Number(p.amount) || 0},
          currency: ${safe(p.currency || 'INR')},
          name: ${safe(p.name || 'Lumixo+')},
          description: ${safe(p.description || p.planLabel)},
          prefill: {
            name: ${safe(p.name || '')},
            email: ${safe(p.email || '')}
          },
          theme: { color: '#00a884' },
          modal: {
            ondismiss: function () {
              post({ type: 'cancelled' });
            }
          },
          handler: function (resp) {
            post({
              type: 'success',
              razorpay_order_id: resp.razorpay_order_id || ${safe(p.orderId)},
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature
            });
          }
        };
        try {
          var rzp = new Razorpay(options);
          rzp.on('payment.failed', function (resp) {
            var err = (resp && resp.error) || {};
            post({
              type: 'failed',
              description: err.description || err.reason || 'Payment failed',
              code: err.code || ''
            });
          });
          document.getElementById('msg').textContent = 'Complete payment in the secure sheet…';
          rzp.open();
        } catch (e) {
          post({ type: 'error', message: (e && e.message) || 'Checkout failed to open' });
        }
      }

      if (document.readyState === 'complete') openCheckout();
      else window.addEventListener('load', openCheckout);
    })();
  </script>
</body>
</html>`;
}

export function RazorpayCheckoutModal({ visible, params, onResult }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settled = useRef(false);
  const [loading, setLoading] = useState(true);

  const html = useMemo(
    () => (params ? buildCheckoutHtml(params) : '<html><body></body></html>'),
    [params],
  );

  useEffect(() => {
    if (visible && params) {
      settled.current = false;
      setLoading(true);
    }
  }, [visible, params?.orderId]);

  function settle(result: RazorpayCheckoutOutcome) {
    if (settled.current) return;
    settled.current = true;
    onResult(result);
  }

  function onMessage(ev: WebViewMessageEvent) {
    try {
      const data = JSON.parse(ev.nativeEvent.data) as RazorpayCheckoutOutcome;
      if (!data || typeof data !== 'object' || !('type' in data)) return;
      settle(data);
    } catch {
      // ignore non-JSON noise
    }
  }

  return (
    <Modal
      visible={visible && !!params}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => settle({ type: 'cancelled' })}
    >
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Secure checkout</Text>
          <Pressable
            onPress={() => settle({ type: 'cancelled' })}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close checkout"
          >
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading Razorpay…</Text>
          </View>
        )}
        {params && (
          <WebView
            originWhitelist={['*']}
            source={{ html, baseUrl: 'https://api.razorpay.com' }}
            onMessage={onMessage}
            onLoadEnd={() => setLoading(false)}
            onError={() =>
              settle({ type: 'error', message: 'Could not load payment page. Check your network.' })
            }
            onHttpError={() =>
              settle({ type: 'error', message: 'Payment page failed to load. Try again.' })
            }
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            style={styles.webview}
            setSupportMultipleWindows={false}
          />
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sheet: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing(4),
      paddingVertical: spacing(3),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { color: colors.text, fontSize: font.heading, fontWeight: '700' },
    close: { color: colors.primary, fontSize: font.body, fontWeight: '600' },
    loading: {
      position: 'absolute',
      top: 80,
      left: 0,
      right: 0,
      zIndex: 2,
      alignItems: 'center',
      gap: spacing(2),
    },
    loadingText: { color: colors.textMuted, fontSize: font.small },
    webview: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.md },
  });
