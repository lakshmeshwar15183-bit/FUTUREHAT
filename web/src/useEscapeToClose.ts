// FUTUREHAT — close a modal/overlay when the user presses Escape.
// Pairs with the existing click-outside-to-close behaviour so every modal
// dismisses consistently (WhatsApp-grade keyboard ergonomics).
import { useEffect } from 'react';

export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}
