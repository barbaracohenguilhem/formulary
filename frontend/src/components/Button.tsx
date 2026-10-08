import type { ReactNode } from 'react';
import s from './Button.module.css';

type Variant = 'solid' | 'outline' | 'quiet';

export function Button({
  variant,
  onClick,
  disabled,
  className,
  children,
}: {
  variant: Variant;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[s.base, s[variant], disabled ? s.disabled : '', className ?? ''].join(' ')}
    >
      {children}
    </button>
  );
}

/**
 * The solid action button. With a real target it is a link — a web address opens in
 * its own tab, a tel:/mailto: hands off to the device — and the tap is still logged.
 */
export function ActionButton({ cta, href, onClick }: { cta: string; href?: string; onClick: () => void }) {
  const className = [s.base, s.solid, s.action].join(' ');
  if (href) {
    const external = /^https?:\/\//i.test(href);
    return (
      <a
        className={className}
        href={href}
        onClick={onClick}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {cta}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {cta}
    </button>
  );
}

export { s as buttonStyles };
