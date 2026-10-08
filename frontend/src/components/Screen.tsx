import type { ReactNode } from 'react';
import s from './Screen.module.css';
import { lot as lotNumber } from '../lib/format';

/** Screen shell: a fixed head, a scrolling body. `key` the screen to replay `rise`. */
export function Screen({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className={s.screen}>
      <div className={s.head}>{head}</div>
      <div className={s.scroll}>{children}</div>
    </div>
  );
}

/** `← index` / `lot 014` — the head of every label screen. */
export function LotBar({
  back,
  onBack,
  id,
  arrow = true,
}: {
  back: string;
  onBack: () => void;
  id: number;
  arrow?: boolean;
}) {
  return (
    <div className={s.lotbar}>
      <button className={s.back} onClick={onBack}>
        {arrow ? `← ${back}` : back}
      </button>
      <span className={s.lot}>lot {lotNumber(id)}</span>
    </div>
  );
}

export { s as screenStyles };
