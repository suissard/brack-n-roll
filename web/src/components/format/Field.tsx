import type { ReactNode } from 'react';

export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`format-field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
