import s from './Index.module.css';
import type { Task } from '../types';
import { lot, rowMeta } from '../lib/format';

/** The first open lot of the tab, set solid. Rotates to the next one once it is done. */
export function Hero({
  task,
  kicker,
  now,
  saving,
  onOpen,
  onDone,
}: {
  task: Task;
  kicker: string;
  now: Date;
  saving?: boolean;
  onOpen: () => void;
  onDone: () => void;
}) {
  const [lead, tail] = rowMeta(task, now);
  const awaitingBarbara = !!task.prepared && !task.prepared.completed && ['barbara', 'changes'].includes(task.prepared.review);
  return (
    <section className={s.hero}>
      <div className={s.heroKick}>
        <span>{kicker}</span>
        <span>lot {lot(task.lot)}</span>
      </div>
      <button type="button" className={s.heroTitle} onClick={onOpen}>
        {task.title}
      </button>
      <div className={s.heroMeta}>
        <b>{lead}</b>
        {lead ? tail : tail.replace(/^ · /, '')}
      </div>
      <button type="button" className={s.heroDone} disabled={saving || awaitingBarbara} onClick={onDone}>
        {saving ? 'saving…' : awaitingBarbara ? 'with barbara' : task.prepared ? 'approve for barbara' : 'mark as done'}
      </button>
    </section>
  );
}
