import s from './Index.module.css';
import type { Tab } from '../types';

const TABS: Tab[] = ['today', 'upcoming', 'archive'];

export function TabBar({ tab, onSelect }: { tab: Tab; onSelect: (t: Tab) => void }) {
  return (
    <nav className={s.tabs}>
      {TABS.map((t) => (
        <button
          key={t}
          type="button"
          aria-current={t === tab ? 'page' : undefined}
          className={[s.tab, t === tab ? s.tabOn : ''].join(' ')}
          onClick={() => onSelect(t)}
        >
          <span>{t}</span>
        </button>
      ))}
    </nav>
  );
}
