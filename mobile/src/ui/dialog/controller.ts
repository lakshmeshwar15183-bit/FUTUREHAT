// Imperative dialog API — drop-in replacement for React Native Alert.alert.
import type { DialogButton, DialogOptions, HostRequest, PromptOptions, SheetOptions } from './types';

type Host = { enqueue: (r: HostRequest) => void };

let host: Host | null = null;

export function bindDialogHost(h: Host | null) {
  host = h;
}

function enqueue(r: HostRequest) {
  if (!host) {
    // Fallback if host not mounted yet (very early boot) — no-op safe.
    console.warn('[dialog] host not ready', r.kind);
    r.resolve();
    return;
  }
  host.enqueue(r);
}

/** Premium alert / confirm. API mirrors React Native Alert.alert for easy migration. */
export function showAlert(
  title: string,
  message?: string,
  buttons?: DialogButton[],
  options?: { cancelable?: boolean; tone?: DialogOptions['tone']; icon?: DialogOptions['icon'] },
): void {
  enqueue({
    kind: 'alert',
    opts: {
      title,
      message,
      buttons: buttons?.length ? buttons : [{ text: 'OK', style: 'primary' }],
      dismissible: options?.cancelable !== false,
      tone: options?.tone,
      icon: options?.icon,
    },
    resolve: () => {},
  });
}

/** Promise-based confirm. Resolves true if primary/destructive pressed, false if cancel. */
export function showConfirm(opts: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  icon?: DialogOptions['icon'];
}): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({
      kind: 'alert',
      opts: {
        title: opts.title,
        message: opts.message,
        icon: opts.icon,
        tone: opts.destructive ? 'danger' : 'default',
        buttons: [
          {
            text: opts.confirmText ?? 'Confirm',
            style: opts.destructive ? 'destructive' : 'primary',
            onPress: () => resolve(true),
          },
          {
            text: opts.cancelText ?? 'Cancel',
            style: 'cancel',
            onPress: () => resolve(false),
          },
        ],
      },
      resolve: () => {},
    });
  });
}

export function showSheet(opts: SheetOptions): void {
  enqueue({ kind: 'sheet', opts, resolve: () => {} });
}

export function showPrompt(opts: PromptOptions): void {
  enqueue({ kind: 'prompt', opts, resolve: () => {} });
}

/**
 * Drop-in stand-in for React Native's `Alert` so call sites can keep
 * `Alert.alert(title, msg, buttons)` shape with premium UI.
 */
export const Alert = {
  alert(
    title: string,
    message?: string,
    buttons?: Array<{
      text: string;
      onPress?: () => void | Promise<void>;
      style?: 'default' | 'cancel' | 'destructive' | 'primary';
    }>,
    options?: { cancelable?: boolean },
  ) {
    const mapped: DialogButton[] = (buttons ?? [{ text: 'OK', style: 'primary' }]).map((b) => ({
      text: b.text,
      onPress: b.onPress,
      style: b.style === 'destructive' ? 'destructive' : b.style === 'cancel' ? 'cancel' : b.style === 'primary' ? 'primary' : 'default',
      role: b.style === 'destructive' ? 'destructive' : b.style === 'cancel' ? 'cancel' : undefined,
    }));
    // Single button → primary (info / success OK buttons)
    if (mapped.length === 1) mapped[0].style = mapped[0].style === 'destructive' ? 'destructive' : 'primary';
    // Two buttons classic RN: often [cancel, destructive] or [cancel, ok]
    if (mapped.length >= 2) {
      const hasPrimary = mapped.some((m) => m.style === 'primary' || m.style === 'destructive');
      if (!hasPrimary) {
        // Last non-cancel becomes primary
        for (let i = mapped.length - 1; i >= 0; i--) {
          if (mapped[i].style !== 'cancel') {
            mapped[i].style = 'primary';
            break;
          }
        }
      }
    }
    showAlert(title, message, mapped, { cancelable: options?.cancelable });
  },

  /**
   * Cross-platform prompt (replaces iOS-only Alert.prompt).
   * Callback form matches RN: (title, message?, callback)
   */
  prompt(
    title: string,
    message?: string,
    callbackOrButtons?: ((text: string) => void) | DialogButton[],
    _type?: string,
    defaultValue?: string,
  ) {
    const cb = typeof callbackOrButtons === 'function' ? callbackOrButtons : undefined;
    showPrompt({
      title,
      message,
      icon: 'report',
      fields: [{ key: 'value', placeholder: 'Type here…', initial: defaultValue ?? '' }],
      submitLabel: 'Submit',
      onSubmit: (values) => {
        cb?.(values.value ?? '');
      },
    });
  },
};
