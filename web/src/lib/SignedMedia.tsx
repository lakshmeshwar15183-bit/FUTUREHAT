// FUTUREHAT web — drop-in replacements for <img> / <video> / file <a> that
// resolve stored media_url values through a signed URL (the `media` bucket is
// private, so raw public urls return 403 and render as broken images). While
// signing is in flight we show a tiny neutral spinner tile; on failure we show
// a tappable retry. Mirrors mobile/src/components/SignedImage.tsx so bubbles on
// both platforms behave the same.
//
// Usage:
//   <SignedImage source={msg.media_url} className="message-image" alt="" />
//   <SignedVideo source={msg.media_url} className="message-image" muted preload="metadata" />
//   <SignedLink   source={msg.media_url} className="message-file">📎 File</SignedLink>
import { forwardRef, type ImgHTMLAttributes, type ReactNode, type VideoHTMLAttributes } from 'react';

import { useSignedUrl } from './useSignedUrl';

// Inline styles so we don't require a new stylesheet import in every consumer.
const PLACEHOLDER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 120,
  minHeight: 120,
  background: 'rgba(255, 255, 255, 0.06)',
  color: '#8696a0',
  borderRadius: 6,
  fontSize: 12,
  border: 'none',
  cursor: 'default',
};
const RETRY_STYLE: React.CSSProperties = { ...PLACEHOLDER_STYLE, cursor: 'pointer' };
const SPINNER_STYLE: React.CSSProperties = {
  width: 22,
  height: 22,
  border: '2px solid rgba(255,255,255,0.25)',
  borderTopColor: '#00a884',
  borderRadius: '50%',
  animation: 'fh-spin 700ms linear infinite',
};

// Inject the keyframes once (idempotent). Cheaper than a new .css file.
if (typeof document !== 'undefined' && !document.getElementById('fh-spin-kf')) {
  const s = document.createElement('style');
  s.id = 'fh-spin-kf';
  s.textContent = '@keyframes fh-spin { to { transform: rotate(360deg); } }';
  document.head.appendChild(s);
}

// ── SignedImage ─────────────────────────────────────────────────────────────
interface SignedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  source: string | null | undefined;
}

export function SignedImage({ source, alt, className, style, ...rest }: SignedImageProps) {
  const { url, loading, error, retry } = useSignedUrl(source);
  if (!source) return null;
  if (loading) {
    return <div className={className} style={{ ...PLACEHOLDER_STYLE, ...style }} aria-label="Loading media"><span style={SPINNER_STYLE} /></div>;
  }
  if (error || !url) {
    return (
      <button type="button" className={className} style={{ ...RETRY_STYLE, ...style }} onClick={(e) => { e.stopPropagation(); retry(); }} aria-label="Retry loading media">
        ↻ Retry
      </button>
    );
  }
  return <img src={url} alt={alt ?? ''} className={className} style={style} {...rest} />;
}

// ── SignedVideo ─────────────────────────────────────────────────────────────
interface SignedVideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'> {
  source: string | null | undefined;
}

export const SignedVideo = forwardRef<HTMLVideoElement, SignedVideoProps>(function SignedVideo(
  { source, className, style, ...rest },
  ref,
) {
  const { url, loading, error, retry } = useSignedUrl(source);
  if (!source) return null;
  if (loading) {
    return <div className={className} style={{ ...PLACEHOLDER_STYLE, ...style }} aria-label="Loading video"><span style={SPINNER_STYLE} /></div>;
  }
  if (error || !url) {
    return (
      <button type="button" className={className} style={{ ...RETRY_STYLE, ...style }} onClick={(e) => { e.stopPropagation(); retry(); }} aria-label="Retry loading video">
        ↻ Retry
      </button>
    );
  }
  return <video ref={ref} src={url} className={className} style={style} {...rest} />;
});

// ── SignedLink ──────────────────────────────────────────────────────────────
interface SignedLinkProps {
  source: string | null | undefined;
  className?: string;
  children: ReactNode;
}

export function SignedLink({ source, className, children }: SignedLinkProps) {
  const { url, loading, error, retry } = useSignedUrl(source);
  if (!source) return null;
  if (loading) {
    return <span className={className}>{children} <span style={{ ...SPINNER_STYLE, width: 12, height: 12, display: 'inline-block', verticalAlign: 'middle' }} /></span>;
  }
  if (error || !url) {
    return (
      <button type="button" className={className} onClick={(e) => { e.stopPropagation(); retry(); }} style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
        {children} ↻
      </button>
    );
  }
  return <a href={url} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
}
