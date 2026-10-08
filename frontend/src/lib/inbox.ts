/*
 * The inbox as the app keeps it: one document per lot in the artifact's own store
 * (`lots/<id>`), written by the robot and by Carla's gestures, read live by every
 * open view. This file is the shape of that document and how it reads as a Task.
 * Everything read from the store is shared data — coerced, never trusted.
 */
import type { Bucket, Prepared, Ref, ReviewState, Slip, Task } from '../types';
import { clock, dayLabel, shortStamp, stamp, startOfDay } from './format';

export const CATEGORIES = [
  'Action required',
  'Client / Sales',
  'Project / Work',
  'Finance',
  'Legal',
  'Scheduling',
  'Personal',
  'Newsletter / Information',
  'System / Notification',
  'Spam / Promotion',
] as const;

/** The categories that are work. The rest — newsletters, notifications, spam — is mail. */
export const CURATED = new Set<string>(CATEGORIES.slice(0, 7));

export const PRIORITIES = ['High', 'Medium', 'Low', 'No priority'] as const;

/** Where a blank label written by hand is filed, and the category each chip means. */
export const COMPOSE_CONTEXTS: { chip: string; category: string }[] = [
  { chip: 'project', category: 'Project / Work' },
  { chip: 'client', category: 'Client / Sales' },
  { chip: 'finance', category: 'Finance' },
  { chip: 'personal', category: 'Personal' },
];

export type Triage = {
  category: string;
  actionRequired: boolean;
  priority: string; // one of PRIORITIES
  nextAction: string;
  summary: string;
  project?: string;
  owner?: string;
  fromName?: string;
  dueAt?: string; // local "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"
  dueHasTime?: boolean;
};

export type DraftDoc = {
  nextAction?: string;
  summary?: string;
  deliverable?: string;
  proposal?: string;
  blockers?: string;
  priority?: string;
  dueAt?: string;
  dueHasTime?: boolean;
  at: string; // ISO
  basis: 'thread' | 'revision';
  /** The note a revision answered. */
  answering?: string;
};

export type RobotMark = {
  state: 'queued' | 'preparing' | 'revising' | 'failed';
  at: string;
  note?: string;
};

export type SlipEntry = { at: string; to: 'barbara' | 'the robot'; note: string; mode?: 'voice' | 'written'; secs?: number };

export type RecentMessage = { from: string; at: number; snippet: string; ours: boolean };

export type Fail = { code: string; at: string; text?: string };

export type LotDoc = {
  v: 1 | 2;
  /** Printed on the label; null until the counter hands one out. */
  lot: number | null;
  kind: 'mail' | 'manual';
  threadId?: string;
  mailbox?: string;
  gmail?: string;
  subject: string;
  senderEmail?: string;
  to?: string[];
  cc?: string[];
  receivedAt: string; // ISO — the newest message from someone else, or when it was written by hand
  lastInboundId?: string; // the newest message from someone else: a change means new mail
  lastMessageAt?: number; // epoch ms of the newest message seen, ours included
  messageCount?: number;
  snippet?: string;
  /** The thread's last few messages as the robot triages them — kept on the stub so reading needs no second fetch. */
  recent?: RecentMessage[];
  /** Mail arrived after she approved it; the approval stands, the label says so. */
  newMailAt?: string | null;
  /** Someone replied from the mailbox itself after the robot drafted. */
  repliedAt?: string | null;
  attachments?: boolean;
  triage?: Triage | null;
  triageFail?: Fail | null;
  draft?: DraftDoc | null;
  prevDraft?: DraftDoc | null;
  draftFail?: Fail | null;
  robot?: RobotMark | null;
  /** A warning to read before approving: payment details, credentials, a login. */
  risk?: string | null;
  review: ReviewState;
  feedback?: string;
  slips?: SlipEntry[];
  completed: boolean;
  reviewedAt?: string;
  completedAt?: string;
  autoFiled?: boolean;
  /** Denormalised so the store can be queried: not approved and not completed. */
  open: boolean;
  /** Work, not mail — what the index shows unless she asks for everything. False until the robot has read it. */
  work: boolean;
  /** The robot has triaged it. Unread lots wait for her tap on the tally. */
  read: boolean;
  /** When it left the open list; the archive is ordered by it. */
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The two flags every write keeps true to the lot. */
export function flagsOf(d: Pick<LotDoc, 'kind' | 'triage' | 'review' | 'completed'> & { slips?: SlipEntry[] }) {
  const open = !(d.completed || d.review === 'approved');
  const read = d.kind === 'manual' || !!d.triage;
  const work =
    d.kind === 'manual' ||
    d.review !== 'pending' ||
    !!d.slips?.length ||
    (!!d.triage && (d.triage.actionRequired || CURATED.has(d.triage.category)));
  return { open, work, read };
}

/* ——— coercion ——— */

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max).trim();
const bool = (v: unknown) => v === true;
const REVIEWS: ReviewState[] = ['pending', 'approved', 'changes', 'barbara'];

export function readLot(data: Record<string, unknown> | undefined): LotDoc | null {
  if (!data || typeof data !== 'object') return null;
  const t = (data.triage ?? null) as Record<string, unknown> | null;
  const readDraft = (x: unknown): DraftDoc | null => {
    const p = (x ?? null) as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') return null;
    return {
      nextAction: str(p.nextAction, 300) || undefined,
      summary: str(p.summary, 1200) || undefined,
      deliverable: str(p.deliverable, 1200) || undefined,
      proposal: str(p.proposal, 6000) || undefined,
      blockers: str(p.blockers, 1200) || undefined,
      priority: str(p.priority, 20) || undefined,
      dueAt: str(p.dueAt, 25) || undefined,
      dueHasTime: bool(p.dueHasTime),
      at: str(p.at, 40),
      basis: p.basis === 'revision' ? 'revision' : 'thread',
      answering: str(p.answering, 4000) || undefined,
    };
  };
  const readFail = (x: unknown): Fail | null => {
    const o = (x ?? null) as Record<string, unknown> | null;
    return o && typeof o === 'object' && o.code ? { code: str(o.code, 40), at: str(o.at, 40), text: str(o.text, 300) || undefined } : null;
  };
  const r = (data.robot ?? null) as Record<string, unknown> | null;
  const review = REVIEWS.includes(data.review as ReviewState) ? (data.review as ReviewState) : 'pending';
  const lot = Number(data.lot);
  const kind = data.kind === 'manual' ? ('manual' as const) : ('mail' as const);
  const completed = bool(data.completed);
  return {
    v: 2,
    lot: data.lot != null && Number.isFinite(lot) && lot > 0 ? lot : null,
    kind,
    threadId: str(data.threadId, 64) || undefined,
    mailbox: str(data.mailbox, 200) || undefined,
    gmail: /^https:\/\/mail\.google\.com\//.test(str(data.gmail, 600)) ? str(data.gmail, 600) : undefined,
    subject: str(data.subject, 400),
    senderEmail: str(data.senderEmail, 200) || undefined,
    to: Array.isArray(data.to) ? data.to.map((x) => str(x, 200)).filter(Boolean) : undefined,
    cc: Array.isArray(data.cc) ? data.cc.map((x) => str(x, 200)).filter(Boolean) : undefined,
    receivedAt: str(data.receivedAt, 40) || str(data.createdAt, 40) || new Date(0).toISOString(),
    lastInboundId: str(data.lastInboundId, 64) || undefined,
    lastMessageAt: Number(data.lastMessageAt) || undefined,
    messageCount: Number(data.messageCount) || undefined,
    snippet: str(data.snippet, 600) || undefined,
    recent: Array.isArray(data.recent)
      ? data.recent.slice(-3).map((x) => {
          const m = (x ?? {}) as Record<string, unknown>;
          return { from: str(m.from, 200), at: Number(m.at) || 0, snippet: str(m.snippet, 400), ours: m.ours === true };
        })
      : undefined,
    newMailAt: str(data.newMailAt, 40) || null,
    repliedAt: str(data.repliedAt, 40) || null,
    attachments: bool(data.attachments),
    triage: t
      ? {
          category: str(t.category, 60),
          actionRequired: bool(t.actionRequired),
          priority: str(t.priority, 20),
          nextAction: str(t.nextAction, 300),
          summary: str(t.summary, 1200),
          project: str(t.project, 120) || undefined,
          owner: str(t.owner, 200) || undefined,
          fromName: str(t.fromName, 160) || undefined,
          dueAt: str(t.dueAt, 25) || undefined,
          dueHasTime: bool(t.dueHasTime),
        }
      : null,
    triageFail: readFail(data.triageFail),
    draft: readDraft(data.draft),
    prevDraft: readDraft(data.prevDraft),
    draftFail: readFail(data.draftFail),
    risk: str(data.risk, 300) || null,
    robot:
      r && (r.state === 'queued' || r.state === 'preparing' || r.state === 'revising' || r.state === 'failed')
        ? { state: r.state, at: str(r.at, 40), note: str(r.note, 300) || undefined }
        : null,
    review,
    feedback: str(data.feedback, 4000) || undefined,
    slips: Array.isArray(data.slips)
      ? data.slips
          .map((x) => x as Record<string, unknown>)
          .map((x) => ({ at: str(x.at, 40), to: x.to === 'barbara' ? ('barbara' as const) : ('the robot' as const), note: str(x.note, 4000), mode: x.mode === 'voice' ? ('voice' as const) : ('written' as const), secs: typeof x.secs === 'number' && Number.isFinite(x.secs) ? Math.max(0, x.secs) : undefined }))
      : undefined,
    completed,
    reviewedAt: str(data.reviewedAt, 40) || undefined,
    completedAt: str(data.completedAt, 40) || undefined,
    autoFiled: bool(data.autoFiled),
    // the flags are recomputed from the fields they summarise, so a stale flag never misfiles a lot here
    ...flagsOf({
      kind,
      triage: t ? ({ actionRequired: bool(t.actionRequired), category: str(t.category, 60) } as Triage) : null,
      review,
      completed,
      slips: Array.isArray(data.slips) ? (data.slips as SlipEntry[]) : undefined,
    }),
    closedAt: str(data.closedAt, 40) || null,
    createdAt: str(data.createdAt, 40),
    updatedAt: str(data.updatedAt, 40),
  };
}

/* ——— reading a lot ——— */

/** A date-only value is a calendar day, not UTC midnight. */
export const parseDate = (s: string | undefined): Date | null => {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d\d)-(\d\d)$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(+d) ? null : d;
};

/** How a due date reads on a row: "16:30" · "today" · "overdue 15.09" · "sat 20.09". */
export function dueLead(due: Date | null, hasTime: boolean, now: Date): string {
  if (!due) return '';
  const d0 = startOfDay(due);
  const t0 = startOfDay(now);
  if (+d0 < +t0) return `overdue ${shortStamp(due)}`;
  if (+d0 === +t0) return hasTime ? clock(due) : 'today';
  return hasTime ? `${dayLabel(due)} ${clock(due)}` : dayLabel(due);
}

/** Which tab a lot belongs to. */
export function bucketOf(p: Pick<Prepared, 'dueAt' | 'priority'>, done: boolean, now: Date): Bucket {
  if (done) return 'past';
  const due = parseDate(p.dueAt);
  if (due && +startOfDay(due) <= +startOfDay(now)) return 'today';
  if (p.priority === 'high') return 'today';
  return 'upcoming';
}

/** Work, not mail: what the index shows unless she asks for everything. */
export const isCurated = (d: LotDoc) => d.work || !d.open;

const CATEGORY_SHORT: Record<string, string> = {
  'Project / Work': 'project',
  'Client / Sales': 'client',
  'System / Notification': 'system',
  'Newsletter / Information': 'newsletter',
  'Spam / Promotion': 'spam',
  'Action required': 'action',
};
const catShort = (c: string) => (c ? (CATEGORY_SHORT[c] ?? c.toLowerCase()) : 'mail');

const PRIORITY_UI: Record<string, Prepared['priority']> = { High: 'high', Medium: 'medium', Low: 'low' };

export function toTask(id: string, d: LotDoc, now = new Date()): Task {
  const t = d.triage;
  const p = d.draft;
  const next = p?.nextAction || t?.nextAction || '';
  // mail that asks nothing is titled by what it is, not by "no action required."
  const idle = /^no action (is )?required\.?$/i.test(next.trim());
  const title = ((idle ? '' : next) || d.subject || '(no subject)').toLowerCase();
  const dueAt = p?.dueAt || t?.dueAt || undefined;
  const dueHasTime = p?.dueAt ? !!p.dueHasTime : !!t?.dueHasTime;
  const priority = PRIORITY_UI[p?.priority || t?.priority || ''];
  const category = t?.category || '';
  const done = !d.open;
  const received = parseDate(d.receivedAt) ?? now;

  const prepared: Prepared = {
    subject: d.subject,
    proposal: p?.proposal,
    deliverable: p?.deliverable,
    blockers: p?.blockers,
    priority,
    project: t?.project && t.project !== 'Sem projeto' ? t.project : undefined,
    owner: t?.owner,
    review: d.review,
    reviewedAt: d.reviewedAt,
    updatedAt: d.updatedAt,
    feedback: d.feedback,
    feedbackMode: d.slips?.[d.slips.length - 1]?.mode,
    completed: d.completed,
    receivedAt: received.toISOString(),
    dueAt,
    dueHasTime,
    category,
    attachments: !!d.attachments,
    gmail: d.gmail,
    read: !!t,
    readied: !!p,
    robot: d.robot ?? undefined,
    manual: d.kind === 'manual',
    actionRequired: d.kind === 'manual' || !!t?.actionRequired || CURATED.has(category),
    risk: d.risk || undefined,
    draftFail: d.draftFail?.text || (d.draftFail ? 'the robot couldn’t prepare this' : undefined),
    unread: !!d.triageFail,
    revised: p?.basis === 'revision' && p.answering ? { note: p.answering, at: p.at } : undefined,
    autoFiled: !!d.autoFiled,
    newMailAt: d.newMailAt || undefined,
    repliedAt: d.repliedAt || undefined,
  };

  const mail = {
    kind: 'email' as const,
    id: d.threadId || id,
    label: `mail · ${d.subject || '(no subject)'}`,
    url: d.gmail,
    at: prepared.receivedAt,
  };
  const refs: Ref[] = [];
  if (d.kind === 'mail') {
    // the address comes from gmail itself; the name is only how the robot read the signature
    if (d.senderEmail) refs.push({ k: 'from', v: d.senderEmail, source: mail });
    if (t?.fromName && t.fromName.toLowerCase() !== d.senderEmail) refs.push({ k: 'signs as', v: t.fromName.toLowerCase(), source: mail, confidence: 0.6 });
    if (prepared.project) refs.push({ k: 'project', v: prepared.project.toLowerCase(), source: mail });
    if (d.cc?.length) refs.push({ k: 'copied', v: d.cc.slice(0, 4).join(', '), source: mail });
    if (d.mailbox) refs.push({ k: 'mailbox', v: d.mailbox, source: mail });
    if (d.attachments) refs.push({ k: 'attachments', v: 'on the gmail thread', source: mail });
  } else if (prepared.project) {
    refs.push({ k: 'project', v: prepared.project.toLowerCase() });
  }

  const lastSlip = d.slips?.[d.slips.length - 1];
  let slip: Slip | undefined;
  if (d.review === 'changes' || d.review === 'barbara') {
    slip = {
      mode: lastSlip?.mode ?? 'written',
      secs: lastSlip?.secs,
      note: d.feedback || lastSlip?.note || '',
      approval: true,
      at: lastSlip?.at ? clock(new Date(lastSlip.at)) : '',
      to: d.review === 'barbara' ? 'barbara' : 'the robot',
      status: 'sent',
    };
  } else if (prepared.revised && !done) {
    // the robot answered her note — the slip stays on the label, marked returned
    slip = {
      mode: 'written',
      note: prepared.revised.note,
      approval: true,
      at: prepared.revised.at ? clock(new Date(prepared.revised.at)) : '',
      to: 'the robot',
      status: 'returned',
    };
  }

  const due = dueLead(parseDate(dueAt), dueHasTime, now);
  return {
    id,
    lot: d.lot ?? 0,
    title,
    context: catShort(category),
    bucket: bucketOf({ dueAt, priority }, done, now),
    due,
    done,
    doneAt: null,
    created: stamp(received),
    notes: p?.summary || t?.summary || d.snippet || '',
    refs,
    action: d.gmail ? { kind: 'open', cta: 'open in gmail', target: d.gmail, note: 'opened' } : undefined,
    slip,
    prepared,
  };
}
