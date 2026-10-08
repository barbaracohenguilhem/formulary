import type { Bucket, DoneAt, Slip, Task } from '../types';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Lot number as printed on the label: 14 → "014". A lot still waiting for its number reads "···". */
export const lot = (id: number) => (id > 0 ? pad(id, 3) : '···');

/** Two-digit tally figure: 4 → "04". */
export const tallyNumber = (n: number) => pad(n, 2);

export const shiftDays = (days: number, from = new Date()) => {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
};

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** "16.09.2026" */
export const stamp = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

/** "16.09" */
export const shortStamp = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;

export const sameDay = (a: Date, b: Date) => stamp(a) === stamp(b);

/** "wed 16.09.2026" — the header date, uppercased by CSS. */
export const headerDate = (d: Date) => `${DAYS[d.getDay()]} ${stamp(d)}`;

/** "thu 17.09" — how a non-today date reads on a row. */
export const dayLabel = (d: Date) => `${DAYS[d.getDay()]} ${shortStamp(d)}`;

/** "08:51" */
export const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "today 09:41" · "yesterday 17:20" · "mon 15.09" — when something arrived. */
export const relStamp = (d: Date, today = new Date()) => {
  if (sameDay(d, today)) return `today ${clock(d)}`;
  if (sameDay(d, shiftDays(-1, today))) return `yesterday ${clock(d)}`;
  return dayLabel(d);
};

/** 25 → "25 min"; 60 → "1 h". Uppercased by CSS. */
export const estLabel = (minutes: number) =>
  minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;

/** "0:24" — the slip timer. */
export const timerLabel = (secs: number) => `${Math.floor(secs / 60)}:${pad(secs % 60)}`;

export const doneStampAt = (d: Date): DoneAt => ({
  date: stamp(d),
  time: clock(d),
  full: `${stamp(d)} · ${clock(d)}`,
});

/** The Friday of the current week — what the "this week" chip resolves to. */
export const thisFriday = (from = new Date()) => {
  const ahead = (5 - from.getDay() + 7) % 7 || 7;
  return shiftDays(ahead, from);
};

/**
 * When a lot reads as done on a row: the time if it was finished today,
 * otherwise the day it was filed.
 */
export const doneLabel = (doneAt: DoneAt, today = new Date()) =>
  doneAt.date === stamp(today) ? doneAt.time : doneAt.date.slice(0, 5);

/** The line under the name on a hand-written label: "today, 16:30" / "sat 19.09". */
export const whenLabel = (bucket: Bucket, due: string) =>
  bucket === 'today' && due !== 'today' ? `today, ${due}` : due;

/** The line under the name on any label. */
export const whenOf = (task: Task, today = new Date()) => {
  const p = task.prepared;
  if (!p) return whenLabel(task.bucket, task.due);
  if (task.due) return /^\d\d:\d\d$/.test(task.due) ? `today, ${task.due}` : task.due;
  return `received ${relStamp(new Date(p.receivedAt), today)}`;
};

/** How a handed lot reads on a row. */
const slipLead = (slip: Slip) => {
  if (slip.status === 'returned') return slip.at ? `revised ${slip.at}` : 'revised';
  if (slip.to === 'barbara') return 'with barbara';
  if (slip.to === 'the robot') return 'changes requested';
  return slip.at ? `handed ${slip.at}` : 'handed';
};

/** What the robot is doing to a lot right now, as a row reads it. */
const robotLead = (task: Task) => {
  const r = task.prepared?.robot;
  if (!r || task.done) return '';
  if (r.state === 'revising') return 'revising…';
  if (r.state === 'preparing') return 'preparing…';
  return '';
};

/**
 * Row meta in two parts, so the lead can be inked and the rest muted (§4.1).
 * Returns [lead, tail].
 */
export const rowMeta = (task: Task, today = new Date()): [string, string] => {
  const tail = ` · ${task.context}`;
  const est = task.est != null ? ` · ${estLabel(task.est)}` : '';
  if (task.done) {
    if (task.doneAt) return [`done ${doneLabel(task.doneAt, today)}`, tail];
    const p = task.prepared;
    return [p?.completed ? (p.autoFiled ? 'filed by itself' : 'completed') : 'approved', tail];
  }
  const working = robotLead(task);
  if (working) return [working, `${tail}${est}`];
  if (task.slip) return [slipLead(task.slip), `${tail}${est}`];
  if (task.due) return [task.due, `${tail}${est}`];
  const p = task.prepared;
  return [p ? relStamp(new Date(p.receivedAt), today) : '', `${tail}${est}`];
};

/** Whether the row's lead is set in ink: a time, a deadline, or something handed. */
export const leadInk = (task: Task) => {
  if (task.done) return false;
  if (task.slip || task.prepared?.robot) return true;
  const p = task.prepared;
  return p ? !!p.dueAt || p.priority === 'high' : true;
};
