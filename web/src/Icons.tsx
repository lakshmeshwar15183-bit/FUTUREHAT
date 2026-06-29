// FUTUREHAT — clean line icons (WhatsApp/Material style), original SVG paths.
// All use currentColor so they inherit button text colour. 24px grid.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 22): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
});

export const StatusIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M4.5 12a7.5 7.5 0 0 1 7.5-7.5" />
    <path d="M19.5 12A7.5 7.5 0 0 1 12 19.5" opacity="0.55" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2" opacity="0.35" />
  </svg>
);

export const CommunitiesIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx="17" cy="9.5" r="2.3" />
    <path d="M16 14.5a4.5 4.5 0 0 1 4.5 4.5" />
  </svg>
);

export const NewGroupIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="10" cy="8" r="3.2" />
    <path d="M3.5 19a6.5 6.5 0 0 1 13 0" />
    <path d="M19 7v6M22 10h-6" />
  </svg>
);

export const NewChatIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M20 11.5A8.5 8.5 0 0 1 6.5 19L3 20l1-3.5A8.5 8.5 0 1 1 20 11.5Z" opacity="0.55" />
    <path d="M14.5 7.5l2 2M17.7 5.8a1.4 1.4 0 0 1 2 2L13 14.5l-2.8.7.7-2.8Z" />
  </svg>
);

export const SettingsIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V20a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H4a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H10a1.65 1.65 0 0 0 1-1.51V4a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V10a1.65 1.65 0 0 0 1.51 1H20a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

export const SignOutIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </svg>
);

export const SearchIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const PhoneIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
  </svg>
);

export const VideoIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="2" y="6" width="13" height="12" rx="2.5" />
    <path d="M22 8.5l-7 3.5 7 3.5Z" />
  </svg>
);

export const StarIcon = ({ size, filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(size)} {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 17.9l-5.25 2.76 1-5.86L3.5 9.66l5.9-.86Z" />
  </svg>
);

export const PlusIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const PaperclipIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8" />
  </svg>
);

export const PollIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7 20V10M12 20V4M17 20v-7" />
  </svg>
);

export const ClockIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const MicIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const SendIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4Z" />
  </svg>
);

export const SmileIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
  </svg>
);

export const ReplyIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M9 17l-5-5 5-5" />
    <path d="M4 12h11a5 5 0 0 1 5 5v2" />
  </svg>
);

export const ForwardIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M15 17l5-5-5-5" />
    <path d="M20 12H9a5 5 0 0 0-5 5v2" />
  </svg>
);

export const CopyIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

export const EditIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const TrashIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);

// ── call controls (WhatsApp-style) ───────────────────────────────────────────
export const MicOffIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M9 9V6a3 3 0 0 1 5.12-2.12M15 9.34V10" />
    <path d="M17 11a5 5 0 0 1-.54 2.27M5 11a7 7 0 0 0 10.79 5.88M12 18v3" />
    <path d="M3 3l18 18" />
  </svg>
);

export const VideoOffIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M10.7 6H12.5A2.5 2.5 0 0 1 15 8.5v1.8M15 13.5v2A2.5 2.5 0 0 1 12.5 18H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 5 6" />
    <path d="M22 8.5l-7 3.5M22 8.5v7l-3-1.5" />
    <path d="M3 3l18 18" />
  </svg>
);

export const SpeakerIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 9v6h3.5L13 19V5L7.5 9Z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </svg>
);

export const SpeakerOffIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 9v6h3.5L13 19V5L7.5 9Z" />
    <path d="M17 9.5l4 5M21 9.5l-4 5" />
  </svg>
);

export const CameraFlipIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1l1.2-1.8h6.6L16.5 6h1A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5Z" opacity="0.6" />
    <path d="M9.5 13.5a2.8 2.8 0 0 1 4.9-1.7M14.5 11.5l0-2M14.5 11.5l-2 0" />
    <path d="M14.5 13a2.8 2.8 0 0 1-4.9 1.7M9.6 14.7l0 2M9.6 14.7l2 0" />
  </svg>
);

export const EndCallIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} style={{ transform: 'rotate(135deg)', ...(p.style || {}) }}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" fill="currentColor" stroke="none" />
  </svg>
);

export const MinimizeIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const LockIcon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);
