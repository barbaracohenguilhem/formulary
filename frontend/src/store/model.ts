import type { Context, Screen, Slip, SlipMode, Tab, Task, TaskEvent } from '../types';
import { OWNER, STUDIO, seedTasks } from '../data/seed';
import { clock, dayLabel, doneStampAt, shiftDays, stamp, thisFriday } from '../lib/format';
import { bucketOf } from '../lib/inbox';
import type { Failure } from '../lib/failure';

export const BARS = 28;

/** Where the lots come from: the fixed seed, or the inbox the robot keeps in the artifact's store. */
export type Mode = 'seed' | 'inbox';

/** What the lot store is doing. Only meaningful in inbox mode. */
export type Sync = 'idle' | 'loading' | 'error' | 'offline';

/** What the robot is doing, and what it last found. */
export type Robot = {
  phase: 'idle' | 'listing' | 'reading' | 'drafting' | 'revising' | 'tidying';
  done: number;
  total: number;
  /** Letters waiting to be read, when counted; null when not known yet. */
  fresh: number | null;
  failure: Failure | null;
  /** Another open view holds the robot. */
  elsewhere: boolean;
  /** The last listing reached further back than the robot reads; older mail stays in gmail. */
  skipped: boolean;
  /** Gmail and Claude are both reachable from this view, and this viewer owns the mailbox. */
  able: boolean;
  /** The lot the robot is drafting or revising right now, if any. */
  on: string | null;
  /** A tally run is under way — the tally can stop it. */
  run: boolean;
  /** Cloud build: the scheduled routine picks up queued requests on its next run. */
  routine?: boolean;
};

export const idleRobot = (): Robot => ({
  phase: 'idle',
  done: 0,
  total: 0,
  fresh: null,
  failure: null,
  elsewhere: false,
  skipped: false,
  able: false,
  on: null,
  run: false,
});

export type DueChoice = 'today' | 'tomorrow' | 'this week' | 'someday';

export type Draft = {
  title: string;
  context: Context | string;
  due: DueChoice;
  est: number;
};

export type SlipDraft = {
  mode: SlipMode;
  note: string;
  secs: number;
  approval: boolean;
};

/** A device that has not joined yet: choosing who it is, or waiting for a yes. */
export type Pairing = {
  phase: 'who' | 'asking' | 'waiting' | 'denied' | 'expired' | 'error';
  who?: 'carla' | 'barbara';
  words?: string;
  note?: string;
};

export type JoinAsk = { id: string; who: 'carla' | 'barbara'; label: string; createdAt: string };

export type State = {
  mode: Mode;
  /** Where an inbox keeps its lots: the claude.ai artifact, or the cloud build's own backend. */
  backend: 'artifact' | 'cloud';
  /** Set while this device has not joined the cloud build. */
  pair: Pairing | null;
  /** Devices asking to join, shown to a member who can allow them. */
  joins: JoinAsk[];
  /** Cloud build: who this device belongs to. */
  who: 'carla' | 'barbara' | null;
  sync: Sync;
  failure: Failure | null;
  robot: Robot;
  /** The archive shows its latest lots only. */
  archiveCapped: boolean;
  showAll: boolean;
  /** Lots with a write in flight. */
  pending: Record<string, true>;
  toast: string | null;
  /** The store has answered — writes can be attempted. */
  connected: boolean;
  /** This viewer may change lots: null when the platform said nothing (let a refused write decide). */
  canWrite: boolean | null;

  screen: Screen;
  tab: Tab;
  selectedId: string | null;
  tasks: Task[];
  /** taskId → HH:MM the action was carried out. */
  acted: Record<string, string>;
  events: TaskEvent[];
  slip: SlipDraft;
  recording: boolean;
  level: number[];
  draft: Draft;
  /** The day the seed was laid down, so a new day starts a clean reference set. */
  seededOn: string;
};

export const emptySlip = (): SlipDraft => ({ mode: 'voice', note: '', secs: 0, approval: true });

export const emptyDraft = (): Draft => ({ title: '', context: 'studio', due: 'today', est: 15 });

export const restLevels = () => new Array<number>(BARS).fill(0);

export function initialState(now = new Date()): State {
  return {
    mode: 'seed',
    backend: 'artifact',
    pair: null,
    joins: [],
    who: null,
    sync: 'idle',
    failure: null,
    robot: idleRobot(),
    archiveCapped: false,
    showAll: false,
    pending: {},
    toast: null,
    connected: false,
    canWrite: null,
    screen: 'list',
    tab: 'today',
    selectedId: null,
    tasks: seedTasks(now),
    acted: {},
    events: [],
    slip: emptySlip(),
    recording: false,
    level: restLevels(),
    draft: emptyDraft(),
    seededOn: stamp(now),
  };
}

export type Action =
  | { type: 'boot'; mode: Mode }
  | { type: 'connected'; canWrite: boolean | null }
  | { type: 'loaded'; tasks: Task[]; archiveCapped: boolean }
  | { type: 'loadFailed'; failure: Failure }
  | { type: 'offline'; failure?: Failure }
  | { type: 'robot'; patch: Partial<Robot> }
  | { type: 'backend'; backend: State['backend']; who?: State['who'] }
  | { type: 'pair'; pair: Pairing | null }
  | { type: 'joins'; joins: JoinAsk[] }
  | { type: 'showAll'; on: boolean }
  | { type: 'pending'; id: string; on: boolean }
  | { type: 'replace'; task: Task }
  | { type: 'toast'; text: string | null }
  | { type: 'tab'; tab: Tab }
  | { type: 'open'; id: string }
  | { type: 'back' }
  | { type: 'compose' }
  | { type: 'handoff'; id: string }
  | { type: 'toggleDone'; id: string }
  | { type: 'act'; id: string }
  | { type: 'discard'; id: string }
  | { type: 'create' }
  | { type: 'draft'; patch: Partial<Draft> }
  | { type: 'slip'; patch: Partial<SlipDraft> }
  | { type: 'recording'; on: boolean }
  | { type: 'levels'; levels: number[] }
  | { type: 'second' }
  | { type: 'hand' };

let eventSeq = 0;
const logEvent = (
  events: TaskEvent[],
  taskId: string,
  kind: TaskEvent['kind'],
  detail?: string,
  now = new Date(),
): TaskEvent[] => [
  ...events,
  { id: `e${now.getTime()}-${eventSeq++}`, taskId, kind, at: now.toISOString(), detail },
];

const patchTask = (tasks: Task[], id: string, patch: (t: Task) => Task) =>
  tasks.map((t) => (t.id === id ? patch(t) : t));

const nextLot = (tasks: Task[]) => tasks.reduce((max, t) => Math.max(max, t.lot), 0) + 1;

/** Which due chip lands a new lot in which bucket and reads how on a row. */
export function resolveDue(choice: DueChoice, now = new Date()): { due: string; bucket: Task['bucket']; dueAt?: string } {
  switch (choice) {
    case 'today':
      return { due: 'today', bucket: 'today', dueAt: isoDay(now) };
    case 'tomorrow': {
      const d = shiftDays(1, now);
      return { due: dayLabel(d), bucket: 'upcoming', dueAt: isoDay(d) };
    }
    case 'this week': {
      const d = thisFriday(now);
      return { due: `by ${dayLabel(d)}`, bucket: 'upcoming', dueAt: isoDay(d) };
    }
    case 'someday':
      return { due: 'someday', bucket: 'upcoming' };
  }
}

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Mark an inbox lot done or open again, keeping its review state truthful (the seed's own lots only use done/doneAt). */
export function withDone(task: Task, done: boolean, now: Date): Task {
  if (!task.prepared) return { ...task, done, doneAt: done ? doneStampAt(now) : null };
  const prepared = { ...task.prepared, review: done ? ('approved' as const) : ('pending' as const), completed: done ? task.prepared.completed : false };
  return { ...task, done, doneAt: null, prepared, bucket: done ? task.bucket : bucketOf(prepared, false, now), slip: done ? task.slip : undefined };
}

/** File an inbox lot without approving it. */
export function withFiled(task: Task, now: Date): Task {
  if (!task.prepared) return task;
  const prepared = { ...task.prepared, completed: true };
  return { ...task, done: true, doneAt: null, prepared, bucket: bucketOf(prepared, true, now) };
}

/** Hand an inbox lot back with instructions. */
export function withSlip(task: Task, to: 'barbara' | 'the robot', note: string): Task {
  const slip: Slip = { mode: 'written', note, approval: true, at: '', to, status: 'sent' };
  const prepared = task.prepared
    ? { ...task.prepared, review: to === 'barbara' ? ('barbara' as const) : ('changes' as const) }
    : task.prepared;
  return { ...task, slip, prepared };
}

export function reducer(state: State, action: Action, now = new Date()): State {
  switch (action.type) {
    case 'boot':
      return action.mode === 'inbox'
        ? { ...state, mode: 'inbox', sync: 'loading', tasks: [], acted: {}, events: [] }
        : { ...state, mode: 'seed', sync: 'idle' };

    case 'connected':
      return { ...state, connected: true, canWrite: action.canWrite };

    case 'robot':
      return { ...state, robot: { ...state.robot, ...action.patch } };

    case 'backend':
      return { ...state, backend: action.backend, who: action.who ?? state.who };

    case 'pair':
      return { ...state, pair: action.pair };

    case 'joins':
      return { ...state, joins: action.joins };

    case 'loaded': {
      // the store is live: a lot that left the list closes its label
      const tasks = action.tasks;
      const stillSelected = state.selectedId == null || tasks.some((t) => t.id === state.selectedId);
      return {
        ...state,
        sync: 'idle',
        failure: null,
        tasks,
        archiveCapped: action.archiveCapped,
        ...(stillSelected
          ? {}
          : { screen: 'list' as const, selectedId: null, recording: false, level: restLevels(), slip: emptySlip() }),
      };
    }

    case 'loadFailed':
      return { ...state, sync: 'error', failure: action.failure };

    case 'offline':
      return { ...state, sync: 'offline', failure: action.failure ?? null, connected: false };

    case 'showAll':
      return { ...state, showAll: action.on };

    case 'pending': {
      const pending = { ...state.pending };
      if (action.on) pending[action.id] = true;
      else delete pending[action.id];
      return { ...state, pending };
    }

    case 'replace':
      return { ...state, tasks: patchTask(state.tasks, action.task.id, () => action.task) };

    case 'toast':
      return { ...state, toast: action.text };

    case 'tab':
      return { ...state, tab: action.tab };

    case 'open':
      return { ...state, screen: 'detail', selectedId: action.id };

    case 'back':
      return { ...state, screen: 'list', selectedId: null, slip: emptySlip(), draft: emptyDraft() };

    case 'compose':
      return { ...state, screen: 'compose', draft: emptyDraft() };

    case 'handoff': {
      const task = state.tasks.find((t) => t.id === action.id);
      return {
        ...state,
        screen: 'handoff',
        selectedId: action.id,
        recording: false,
        level: restLevels(),
        // a slip the robot already answered starts a fresh note; one still waiting is edited as it stands
        slip: task?.slip && task.slip.status !== 'returned'
          ? {
              mode: task.slip.mode,
              note: task.slip.note ?? '',
              secs: task.slip.secs ?? 0,
              approval: task.slip.approval,
            }
          : emptySlip(),
      };
    }

    case 'toggleDone': {
      const task = state.tasks.find((t) => t.id === action.id);
      if (!task) return state;
      const nextDone = !task.done;
      return {
        ...state,
        tasks: patchTask(state.tasks, action.id, (t) => withDone(t, nextDone, now)),
        events: logEvent(state.events, action.id, nextDone ? 'done' : 'reopened', undefined, now),
      };
    }

    case 'act': {
      const task = state.tasks.find((t) => t.id === action.id);
      if (!task?.action) return state;
      return {
        ...state,
        acted: { ...state.acted, [action.id]: clock(now) },
        events: logEvent(state.events, action.id, 'acted', task.action.kind, now),
      };
    }

    case 'discard':
      return {
        ...state,
        screen: 'list',
        selectedId: null,
        // an inbox lot is filed, never deleted — the record stays in the store
        tasks:
          state.mode === 'inbox'
            ? patchTask(state.tasks, action.id, (t) => withFiled(t, now))
            : state.tasks.filter((t) => t.id !== action.id),
        events: logEvent(state.events, action.id, 'discarded', undefined, now),
      };

    case 'draft':
      return { ...state, draft: { ...state.draft, ...action.patch } };

    case 'create': {
      // seed mode only — an inbox lot is written to the store and arrives by its snapshot
      const title = state.draft.title.trim();
      if (!title) return state;
      const lot = nextLot(state.tasks);
      const { due, bucket } = resolveDue(state.draft.due, now);
      const task: Task = {
        id: `seed-${lot}`,
        lot,
        title: title.toLowerCase(),
        context: state.draft.context,
        bucket,
        due,
        est: state.draft.est,
        done: false,
        doneAt: null,
        created: stamp(now),
        notes: '',
        refs: [],
      };
      return {
        ...state,
        screen: 'list',
        // creating a lot moves the index to the bucket of the due date it was given
        tab: bucket === 'today' ? 'today' : 'upcoming',
        tasks: [...state.tasks, task],
        draft: emptyDraft(),
        events: logEvent(state.events, task.id, 'created', undefined, now),
      };
    }

    case 'slip':
      return { ...state, slip: { ...state.slip, ...action.patch } };

    case 'recording':
      return {
        ...state,
        recording: action.on,
        ...(action.on ? { slip: { ...state.slip, secs: 0 }, level: restLevels() } : {}),
      };

    case 'levels':
      return { ...state, level: action.levels };

    case 'second':
      return { ...state, slip: { ...state.slip, secs: state.slip.secs + 1 } };

    case 'hand': {
      // seed mode only — an inbox slip is written to the store
      const id = state.selectedId;
      if (id == null) return state;
      const draft = state.slip;
      const hasContent = draft.mode === 'voice' ? draft.secs > 0 : draft.note.trim().length > 0;
      if (!hasContent) return state;
      const slip: Slip = {
        mode: draft.mode,
        approval: draft.approval,
        at: clock(now),
        to: STUDIO,
        status: 'sent',
        ...(draft.mode === 'voice' ? { secs: draft.secs, audioUrl: undefined } : { note: draft.note.trim() }),
      };
      return {
        ...state,
        screen: 'detail',
        tasks: patchTask(state.tasks, id, (t) => ({ ...t, slip })),
        slip: emptySlip(),
        recording: false,
        level: restLevels(),
        events: logEvent(state.events, id, 'handed', slip.mode, now),
      };
    }
  }
}

export { OWNER, STUDIO };
