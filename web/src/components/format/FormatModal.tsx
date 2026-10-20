import { useEffect, useId, type ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/**
 * Modal générique de l'éditeur de format.
 *
 * L'édition est appliquée en direct au brouillon ; la modal sert de fiche de
 * propriétés et se ferme avec Échap, le bouton dédié ou un clic sur le fond.
 */
export function Modal({ title, subtitle, onClose, children, footer, wide = false }: Props) {
  const titleId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="format-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`format-modal${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="format-modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="icon-btn format-modal-close"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer (Échap)"
          >
            ✕
          </button>
        </header>

        <div className="format-modal-body">{children}</div>

        {footer && <footer className="format-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
