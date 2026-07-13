// Lumixo+ badge — shown next to premium users (never inside chat bubbles).

interface Props {
  compact?: boolean;
}

export function PremiumBadge({ compact }: Props) {
  if (compact) {
    return <span className="fh-badge dot" title="Lumixo+">✦</span>;
  }
  return (
    <span className="fh-badge" title="Lumixo+ member">
      ✦ Lumixo+
    </span>
  );
}
