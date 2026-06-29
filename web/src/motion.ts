// FUTUREHAT — consistent motion design tokens.
// One place for easing + spring + variants so every screen moves the same way.
// Tuned for usability: short, interruptible, GPU-friendly (transform/opacity only).

import type { Transition, Variants } from 'framer-motion';

// Apple-like spring — snappy but soft.
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 };
export const softSpring: Transition = { type: 'spring', stiffness: 260, damping: 30 };
export const ease = [0.22, 1, 0.36, 1] as const; // easeOutExpo-ish
export const quick: Transition = { duration: 0.22, ease };

// Page / view transitions.
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease } },
  exit: { opacity: 0, y: -8, scale: 0.99, transition: { duration: 0.2, ease } },
};

// Modal / sheet.
export const modalBackdrop: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const modalPanel: Variants = {
  initial: { opacity: 0, scale: 0.94, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0, transition: spring },
  exit: { opacity: 0, scale: 0.96, y: 10, transition: { duration: 0.16, ease } },
};

// Message bubble entrance — sender vs receiver feel different.
export const bubbleMine: Variants = {
  initial: { opacity: 0, scale: 0.8, x: 24, transformOrigin: 'bottom right' },
  animate: { opacity: 1, scale: 1, x: 0, transition: spring },
};

export const bubbleTheirs: Variants = {
  initial: { opacity: 0, scale: 0.85, x: -16, transformOrigin: 'bottom left' },
  animate: { opacity: 1, scale: 1, x: 0, transition: softSpring },
};

// List item stagger (conversation rows, search results).
export const listItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: quick },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
};

