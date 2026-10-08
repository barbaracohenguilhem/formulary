import s from '../components/Index.module.css';
import { screenStyles as shell } from '../components/Screen';
import { Hero } from '../components/Hero';
import { TabBar } from '../components/TabBar';
import { SkeletonRow, TaskRow } from '../components/TaskRow';
import { Reg } from '../components/Reg';
import { JoinRequests } from '../components/Join';
import type { JoinAsk } from '../store/model';
import type { Tab, Task } from '../types';
import type { ListView } from '../store/useFormulary';
import type { Mode, Robot, Sync } from '../store/model';
import type { Failure } from '../lib/failure';
import { headerDate } from '../lib/format';

const EMPTY: Record<Tab, string> = {
  today: 'nothing needs you today.',
  upcoming: 'nothing coming up.',
  archive: 'nothing filed yet.',
};

export function IndexScreen({
  view,
  tab,
  now,
  mode,
  sync,
  failure,
  robot,
  archiveCapped,
  showAll,
  pending,
  connected,
  canWrite,
  backend = 'artifact',
  joins = [],
  onDecideJoin,
  onConnectGmail,
  onTab,
  onCompose,
  onOpen,
  onToggle,
  onSync,
  onToggleShowAll,
}: {
  view: ListView;
  tab: Tab;
  now: Date;
  mode: Mode;
  sync: Sync;
  failure: Failure | null;
  robot: Robot;
  archiveCapped: boolean;
  showAll: boolean;
  pending: Record<string, true>;
  connected: boolean;
  canWrite: boolean | null;
  backend?: 'artifact' | 'cloud';
  joins?: JoinAsk[];
  onDecideJoin?: (id: string, words: string | null) => Promise<boolean>;
  onConnectGmail?: () => void;
  onTab: (t: Tab) => void;
  onCompose: () => void;
  onOpen: (task: Task) => void;
  onToggle: (task: Task) => void;
  onSync: () => void;
  onToggleShowAll: () => void;
}) {
  const inbox = mode === 'inbox';
  const loading = inbox && sync === 'loading';
  const empty = view.rows.length === 0 && !view.hero;
  const working = robot.phase !== 'idle';
  // a run started by the tally can be stopped from it; one lot's draft is stopped from its label
  const running = robot.run;

  const tally =
    sync === 'offline'
      ? 'offline'
      : loading
        ? 'loading…'
        : robot.phase === 'listing'
          ? `${view.tally} · checking mail…`
          : robot.phase === 'reading'
            ? `reading ${robot.done}/${robot.total} · stop`
            : robot.phase === 'drafting'
              ? running
                ? `drafting ${Math.min(robot.done + 1, robot.total)}/${robot.total} · stop`
                : `${view.tally} · drafting…`
              : robot.phase === 'revising'
                ? running
                  ? 'revising · stop'
                  : `${view.tally} · revising…`
                : robot.phase === 'tidying'
                  ? 'tidying…'
                  : inbox && robot.able
                    ? robot.fresh
                      ? `${view.tally} · ${robot.fresh} new ↻`
                      : `${view.tally} ↻`
                    : view.tally;

  // one muted line for what the robot needs; the store's own trouble keeps the state block below
  const robotLine = !inbox
    ? ''
    : robot.failure
      ? robot.failure.text
      : robot.elsewhere
        ? 'the robot is busy on another device · tap ↻ again in a minute'
        : robot.skipped && tab !== 'archive'
          ? 'older mail stays in gmail · the robot reads the last few days'
          : '';

  return (
    <div className={shell.screen}>
      <div className={shell.head}>
        <div className={s.top}>
          <span className={s.wordmark}>
            formulary
            <Reg />
          </span>
          <button type="button" className={s.new} onClick={onCompose} disabled={inbox && (!connected || canWrite === false)}>
            new +
          </button>
        </div>
        <div className={s.tally}>
          <span>{headerDate(now)}</span>
          {inbox && robot.able ? (
            <button
              type="button"
              className={[s.sync, working && !running ? s.syncBusy : ''].join(' ')}
              onClick={onSync}
              disabled={loading || sync === 'offline' || robot.phase === 'listing' || robot.phase === 'tidying' || (working && !running)}
              aria-label={running ? 'stop the robot' : 'read new mail'}
            >
              {tally}
            </button>
          ) : (
            <span>{tally}</span>
          )}
        </div>
      </div>

      <div className={shell.scroll}>
        {robotLine && sync !== 'offline' && <span className={[s.note, s.robotLine].join(' ')}>{robotLine}</span>}
        {backend === 'cloud' && robot.failure?.source === 'gmail' && ['server_not_connected', 'needs_reauth'].includes(robot.failure.code) && !/google isn/.test(robot.failure.text) && onConnectGmail && (
          <button type="button" className={s.foot} onClick={onConnectGmail}>
            connect gmail · read only →
          </button>
        )}
        {onDecideJoin && <JoinRequests joins={joins} onDecide={onDecideJoin} />}

        {sync === 'offline' && (
          <div className={s.state}>
            {failure ? (
              failure.text
            ) : (
              <>
                sign in to claude.ai to see your lots
                <br />
                — the sign in button is at the top right.
              </>
            )}
          </div>
        )}

        {sync === 'error' && failure && (
          <div>
            <div className={s.state}>
              {failure.text}
              {!empty && ' · showing what loaded last'}
            </div>
            <button type="button" className={s.foot} onClick={onSync}>
              try again
            </button>
          </div>
        )}

        {loading && empty && (
          <>
            <div className={s.section}>
              <span>{view.kicker}</span>
              <span>··</span>
            </div>
            <ul className={s.rows}>
              {Array.from({ length: 6 }, (_, i) => (
                <SkeletonRow key={i} />
              ))}
            </ul>
          </>
        )}

        {sync !== 'offline' && !(loading && empty) && !(sync === 'error' && empty) && (
          <>
            {view.hero && (
              <Hero
                task={view.hero}
                kicker={tab === 'upcoming' ? 'first up' : 'up next'}
                now={now}
                saving={!!pending[view.hero.id]}
                onOpen={() => onOpen(view.hero!)}
                onDone={() => onToggle(view.hero!)}
              />
            )}

            {view.rows.length > 0 && (
              <>
                <div className={s.section}>
                  <span>{view.kicker}</span>
                  <span>{view.count}</span>
                </div>
                <ul className={s.rows}>
                  {view.rows.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      now={now}
                      saving={!!pending[task.id]}
                      onOpen={() => onOpen(task)}
                      onToggle={() => onToggle(task)}
                    />
                  ))}
                </ul>
              </>
            )}

            {inbox && empty && (
              <div className={s.state}>
                {tab !== 'archive' && robot.able && robot.fresh && !working
                  ? `${robot.fresh} letters waiting · tap ↻ to read them`
                  : EMPTY[tab]}
              </div>
            )}

            {inbox && tab === 'archive' && archiveCapped && <span className={s.note}>showing the latest 200</span>}

            {inbox && tab !== 'archive' && (
              <button type="button" className={s.foot} onClick={onToggleShowAll}>
                {showAll ? 'back to work only · hide newsletters & notifications' : 'show all primary mail · the last three days'}
              </button>
            )}
          </>
        )}
      </div>

      <TabBar tab={tab} onSelect={onTab} />
    </div>
  );
}
