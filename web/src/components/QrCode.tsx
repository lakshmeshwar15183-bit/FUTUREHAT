// Lumixo web — SVG QR from shared matrix encoder.
import { useMemo } from 'react';
import { qrMatrixForUrl } from '@shared/qrcode';

interface Props {
  value: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
  className?: string;
}

export function QrCode({
  value,
  size = 200,
  color = '#111111',
  backgroundColor = '#ffffff',
  className,
}: Props) {
  const matrix = useMemo(() => qrMatrixForUrl(value), [value]);
  if (!matrix?.length) {
    return (
      <div
        className={className}
        style={{
          width: size,
          height: size,
          background: backgroundColor,
          borderRadius: 8,
        }}
        aria-label="QR unavailable"
      />
    );
  }
  const n = matrix.length;
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (matrix[y][x]) {
        cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />);
      }
    }
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      role="img"
      aria-label="QR code"
      style={{ background: backgroundColor, borderRadius: 8, display: 'block' }}
    >
      <rect width={n} height={n} fill={backgroundColor} />
      {cells}
    </svg>
  );
}
