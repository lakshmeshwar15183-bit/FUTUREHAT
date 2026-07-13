// Lumixo — shared dialog / sheet types (Telegram-grade system).

export type DialogTone = 'default' | 'danger' | 'success' | 'warning' | 'info';

export type DialogIconName =
  | 'trash'
  | 'warning'
  | 'success'
  | 'info'
  | 'block'
  | 'logout'
  | 'group'
  | 'photo'
  | 'video'
  | 'file'
  | 'lock'
  | 'report'
  | 'exit'
  | 'check'
  | 'alert'
  | 'person'
  | 'settings'
  | 'search'
  | 'star'
  | 'mute'
  | 'unmute'
  | 'wallpaper'
  | 'export'
  | 'clear'
  | 'forward'
  | 'reply'
  | 'copy'
  | 'select'
  | 'edit'
  | 'pin'
  | 'first'
  | 'link'
  | 'none';

export type DialogButtonStyle = 'default' | 'cancel' | 'destructive' | 'primary';

export interface DialogButton {
  text: string;
  onPress?: () => void | Promise<void>;
  style?: DialogButtonStyle;
  /** Alias for style (RN Alert parity) */
  role?: DialogButtonStyle;
}

export interface DialogOptions {
  title: string;
  message?: string;
  buttons?: DialogButton[];
  tone?: DialogTone;
  icon?: DialogIconName;
  /** Optional custom body below message */
  dismissible?: boolean;
}

export interface SheetAction {
  text: string;
  onPress?: () => void | Promise<void>;
  style?: DialogButtonStyle;
  icon?: DialogIconName;
  subtitle?: string;
}

export interface SheetOptions {
  title?: string;
  message?: string;
  actions: SheetAction[];
  cancelText?: string;
}

export interface PromptField {
  key: string;
  placeholder: string;
  initial?: string;
  multiline?: boolean;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
}

export interface PromptOptions {
  title: string;
  message?: string;
  fields: PromptField[];
  submitLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
  icon?: DialogIconName;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
  onCancel?: () => void;
}

export type HostRequest =
  | { kind: 'alert'; opts: DialogOptions; resolve: () => void }
  | { kind: 'sheet'; opts: SheetOptions; resolve: () => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: () => void };
