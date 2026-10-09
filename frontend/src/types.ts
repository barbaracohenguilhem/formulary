/* Data model — handoff §7, extended so a lot can come from the inbox the robot keeps. */

export type Context = 'studio' | 'work' | 'home' | 'errands';
export type Bucket = 'today' | 'upcoming' | 'past';

export type Tab = 'today' | 'upcoming' | 'archive';
export type Screen = 'list' | 'detail' | 'handoff' | 'compose';

/** Where a ref came from. Mandatory in production (§8.6) so every fact is auditable. */
export type Source = {
  kind: 'email' | 'drive' | 'contact' | 'calendar' | 'order' | 'manual';
  id: string;
  label: string;
  url?: string;
  at: string;
};

/** "To hand": what she needs in order to act, gathered by the agent. */
export type Ref = {
  k: string; // "phone", "ask for", "last order"
  v: string; // already readable
  source?: Source;
  confidence?: number; // 0–1 when inferred; < 0.7 is a suggestion, never a fact
};

/** The primary button IS the task. */
export type Action = {
  kind: 'call' | 'mail' | 'map' | 'open' | 'send';
  cta: string; // "call +351 21 342 00 11"
  target: string; // tel:, mailto:, geo:, url
  note: string; // "dialled" | "sent" | "opened"
};

export type SlipMode = 'voice' | 'written';
export type FeedbackRecipient = 'robot' | 'barbara';
export type FeedbackTone = 'warmer' | 'formal' | 'concise' | 'direct';

/** Private object references only; temporary download URLs are never persisted. */
export type FeedbackFile = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  kind: 'audio' | 'file';
  bucket: 'formulary-feedback';
  path: string;
  text?: string;
  extraction: 'ready' | 'partial' | 'unsupported';
  issue?: string;
};

/** Kept only in the open composer, never serialized into localStorage. */
export type FeedbackUpload = Omit<FeedbackFile, 'bucket' | 'path'> & {
  file: File;
  processing: 'reading' | 'ready' | 'error';
  error?: string;
};

export type FeedbackRequest = {
  id: string;
  at: string;
  recipient: FeedbackRecipient;
  tone: FeedbackTone | null;
  note: string;
  mode: SlipMode;
  secs?: number;
  proposalText?: string;
  files: FeedbackFile[];
};
export type SlipStatus = 'sent' | 'seen' | 'in_progress' | 'returned' | 'approved';

/** Handing the lot back with instructions. */
export type Slip = {
  mode: SlipMode;
  note?: string;
  audioUrl?: string;
  secs?: number;
  approval: boolean; // returns to whoever delegated it
  at: string; // HH:MM, or '' when the record keeps no time
  to: string; // recipient: 'the studio' | 'barbara' | 'the robot'
  status: SlipStatus;
  requestId?: string;
  tone?: FeedbackTone | null;
  files?: FeedbackFile[];
};

export type DoneAt = {
  date: string; // "16.09.2026"
  time: string; // "08:51"
  full: string; // "16.09.2026 · 08:51"
};

/** The review column of the inbox, in the app's own words. */
export type ReviewState = 'pending' | 'approved' | 'changes' | 'barbara';

/** What the robot is doing to a lot right now, when anything. */
export type RobotState = {
  state: 'queued' | 'preparing' | 'revising' | 'failed';
  at: string;
  note?: string;
};

/** What the robot prepared on an inbox lot. Present on every inbox lot, hand-written ones included. */
export type Prepared = {
  subject: string; // the mail subject — the title is the next action
  proposal?: string; // the complete reply or action it drafted for approval
  deliverable?: string;
  blockers?: string; // "unable to complete" — what is missing and who must supply it
  priority?: 'high' | 'medium' | 'low';
  project?: string;
  owner?: string;
  review: ReviewState;
  reviewedAt?: string;
  updatedAt?: string;
  feedback?: string;
  feedbackMode?: SlipMode;
  feedbackRequest?: FeedbackRequest;
  completed: boolean;
  receivedAt: string; // ISO
  dueAt?: string; // local date "YYYY-MM-DD" or datetime
  dueHasTime: boolean;
  category: string; // the inbox's category name
  attachments: boolean;
  gmail?: string;
  read: boolean; // the robot has triaged it
  readied: boolean; // the robot has read the whole thread and prepared the reply or action
  robot?: RobotState;
  manual: boolean; // written by hand on a blank label
  actionRequired: boolean; // work the robot should prepare a reply or action for
  risk?: string; // read before approving: payment details, credentials, a login
  draftFail?: string; // why the robot could not prepare it, in her words
  unread: boolean; // the robot could not read it; it stands as it came
  revised?: { note: string; at: string }; // the note the current proposal answers
  autoFiled: boolean; // filed by itself after weeks with no review
  newMailAt?: string; // mail arrived after she approved it
  repliedAt?: string; // the mailbox replied in gmail after the robot drafted
};

export type Task = {
  id: string; // stable key — a seed id, or the lot's document id in the store
  lot: number; // shown as lot "014" (pad 3)
  title: string; // lowercase
  context: string; // one of Context on a seed lot; the category's short name on an inbox lot
  bucket: Bucket;
  due: string; // "16:30" | "fri 19.09" | "someday" | "" when the lot carries no date
  est?: number; // minutes, when known
  done: boolean;
  doneAt: DoneAt | null;
  created: string; // "15.09.2026" — the day it was received, on an inbox lot
  notes: string;

  // ——— the differentiators ———
  refs: Ref[];
  action?: Action;
  slip?: Slip;
  prepared?: Prepared;
};

/** Append-only log (§7). Feeds the archive and the audit trail. */
export type EventKind =
  | 'created'
  | 'acted'
  | 'handed'
  | 'returned'
  | 'approved'
  | 'done'
  | 'reopened'
  | 'discarded';

export type TaskEvent = {
  id: string;
  taskId: string;
  kind: EventKind;
  at: string; // ISO
  detail?: string;
};
