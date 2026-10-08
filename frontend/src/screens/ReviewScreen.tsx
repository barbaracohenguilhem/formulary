import s from './ReviewScreen.module.css';
import index from '../components/Index.module.css';
import { screenStyles as shell } from '../components/Screen';
import { Reg } from '../components/Reg';
import { JoinRequests } from '../components/Join';
import { headerDate, lot, stamp, clock } from '../lib/format';
import { isBarbaraPending } from '../lib/review';
import type { Failure } from '../lib/failure';
import type { JoinAsk, Sync } from '../store/model';
import type { Task } from '../types';

function reviewedDate(task: Task) {
  const value = task.prepared?.reviewedAt || task.prepared?.receivedAt;
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? `${stamp(date)} · ${clock(date)}` : task.created;
}

/** Barbara sees only the work Carla has handed over, directly from the shared lots. */
export function ReviewScreen({
  tasks,
  capped,
  now,
  sync,
  failure,
  pending,
  joins,
  onDecideJoin,
  onOpen,
  onSync,
}: {
  tasks: Task[];
  capped: boolean;
  now: Date;
  sync: Sync;
  failure: Failure | null;
  pending: Record<string, true>;
  joins: JoinAsk[];
  onDecideJoin: (id: string, words: string | null) => Promise<boolean>;
  onOpen: (task: Task) => void;
  onSync: () => void;
}) {
  const queue = tasks.filter(isBarbaraPending).sort((a, b) =>
    (b.prepared?.reviewedAt || b.prepared?.receivedAt || '').localeCompare(a.prepared?.reviewedAt || a.prepared?.receivedAt || ''),
  );
  const loading = sync === 'loading';

  return (
    <div className={shell.screen}>
      <div className={shell.head}>
        <div className={index.top}>
          <span className={index.wordmark}>formulary<Reg /></span>
          <span className={s.person}>barbara</span>
        </div>
        <div className={index.tally}>
          <span>{headerDate(now)}</span>
          <button className={s.refresh} type="button" onClick={onSync} disabled={loading} aria-label="refresh Carla’s handoffs">
            {loading ? 'loading…' : `${queue.length} waiting ↻`}
          </button>
        </div>
      </div>
      <div className={shell.scroll}>
        <h1 className={s.heading}>from carla</h1>
        <p className={s.intro}>Her approvals and instructions, ready for you to take forward.</p>
        <JoinRequests joins={joins} onDecide={onDecideJoin} />
        {capped && <p className={s.notice} role="status">Showing the latest 1,000 handoffs per status. Older items may still be waiting.</p>}

        {(sync === 'error' || sync === 'offline') && (
          <div className={s.notice} role="status">
            {failure?.text || 'The review queue is offline. Refresh to reconnect.'}
            {queue.length > 0 && ' Showing the last loaded handoffs.'}
          </div>
        )}

        {loading && queue.length === 0 ? (
          <p className={index.state} role="status">loading carla’s handoffs…</p>
        ) : queue.length === 0 && sync === 'idle' ? (
          <p className={index.state}>nothing waiting on you.<br />Carla’s next approval or feedback will appear here.</p>
        ) : (
          <ul className={s.queue} aria-label="Carla’s handoffs">
            {queue.map((task) => {
              const prepared = task.prepared!;
              const approved = prepared.review === 'approved';
              const note = prepared.feedback || task.slip?.note;
              const voice = prepared.feedbackMode === 'voice' || task.slip?.mode === 'voice';
              const sender = task.refs.find((ref) => ref.k === 'from')?.v;
              return (
                <li key={task.id}>
                  <button className={s.item} type="button" onClick={() => onOpen(task)} disabled={!!pending[task.id]}>
                    <span className={s.itemHead}>
                      <span>{approved ? 'approved by carla' : prepared.manual ? 'delegated by carla' : 'feedback from carla'}</span>
                      <span>lot {lot(task.lot)}</span>
                    </span>
                    <span className={s.title}>{task.title}</span>
                    {sender && <span className={s.sender}>{sender}</span>}
                    <span className={s.date}>{reviewedDate(task)}</span>
                    {note && !approved && (
                      <span className={s.feedback}>
                        <span className={s.feedbackLabel}>{voice ? 'dictated feedback · transcript' : 'carla’s instructions'}</span>
                        <span className={s.note}>{note}</span>
                      </span>
                    )}
                    <span className={s.open}>{pending[task.id] ? 'saving…' : approved ? 'review approved proposal →' : 'open handoff →'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
