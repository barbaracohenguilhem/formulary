import s from './Index.module.css';
import type { Task } from '../types';
import { leadInk, lot, rowMeta } from '../lib/format';

export function TaskRow({
  task,
  now,
  saving,
  onOpen,
  onToggle,
}: {
  task: Task;
  now: Date;
  saving?: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const [lead, tail] = rowMeta(task, now);
  const awaitingBarbara = !!task.prepared && !task.prepared.completed && ['barbara', 'changes'].includes(task.prepared.review);
  return (
    <li className={[s.row, saving ? s.rowSaving : ''].join(' ')}>
      <button type="button" className={s.open} onClick={onOpen}>
        <span className={[s.serial, task.done ? s.serialDone : ''].join(' ')} key={task.done ? 'done' : 'open'}>
          {lot(task.lot)}
        </span>
        <span className={s.body}>
          <span className={[s.title, task.done ? s.titleDone : ''].join(' ')}>{task.title}</span>
          <span className={s.meta}>
            <span className={leadInk(task) ? s.metaLead : undefined}>{lead}</span>
            {lead ? tail : tail.replace(/^ · /, '')}
          </span>
        </span>
      </button>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `reopen ${task.title}` : awaitingBarbara ? `${task.title} is with barbara` : task.prepared ? `approve ${task.title} for barbara` : `mark ${task.title} as done`}
        className={s.check}
        disabled={saving || awaitingBarbara}
        onClick={onToggle}
      >
        <span className={[s.checkBox, task.done ? s.checkBoxOn : ''].join(' ')} />
      </button>
    </li>
  );
}

/** A row-shaped placeholder while the first sync is in flight. */
export function SkeletonRow() {
  return (
    <li className={s.row} aria-hidden="true">
      <span className={s.open}>
        <span className={s.serial}>···</span>
        <span className={s.body} style={{ flex: 1 }}>
          <span className={s.skelTitle} />
          <span className={s.skelMeta} />
        </span>
      </span>
      <span className={s.check}>
        <span className={s.checkBox} />
      </span>
    </li>
  );
}
