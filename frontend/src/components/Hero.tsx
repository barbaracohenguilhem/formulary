import s from './Index.module.css';
import type { Task } from '../types';
import { lot, rowMeta } from '../lib/format';
import { canApprove } from '../lib/review';

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
  const awaitingBarbara = !!task.prepared && !task.prepared.completed && task.prepared.review === 'barbara';
  const awaitingRobot = !!task.prepared && !task.prepared.completed && task.prepared.review === 'changes';
  const queued = task.prepared?.robot?.state === 'queued';
  const unready = !task.done && !canApprove(task);
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
      <button type="button" className={s.heroDone} disabled={saving || awaitingBarbara || awaitingRobot || queued || unready} onClick={onDone}>
        {saving ? 'saving…' : awaitingRobot ? 'with the robot' : queued ? 'reply queued' : awaitingBarbara ? 'with barbara' : unready ? 'proposal not ready' : task.prepared ? 'approve for barbara' : 'mark as done'}
      </button>
    </section>
  );
}
