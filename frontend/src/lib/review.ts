import type { Task, SlipMode } from '../types';
import type { LotDoc, SlipEntry } from './inbox';

export type ReviewActor = 'carla' | 'barbara' | null;
export type ReviewAction =
  | { kind: 'approve' | 'complete' | 'file' | 'reopen' }
  | { kind: 'feedback'; note: string; mode: SlipMode; secs?: number }
  | { kind: 'return'; proposal: string };

/** Approval is a handoff, not evidence of an email being sent or work being done. */
export function isBarbaraPending(task: Task): boolean {
  const p = task.prepared;
  return !!p && !p.completed && ['approved', 'barbara', 'changes'].includes(p.review);
}

function reject(code: 'review_forbidden' | 'review_conflict' | 'review_invalid', message: string): never {
  throw Object.assign(new Error(message), { code });
}

/** Validate the freshly read lot before merging a change into its shared record. */
export function reviewPatch(doc: LotDoc, actor: ReviewActor, action: ReviewAction, now: string): Record<string, unknown> {
  const expected = action.kind === 'complete' || action.kind === 'return' ? 'barbara' : 'carla';
  if (actor !== expected) reject('review_forbidden', `this action belongs to ${expected}`);
  if (action.kind !== 'reopen' && doc.completed) reject('review_conflict', 'this lot was already handled · refresh to check');
  if (doc.robot?.state === 'preparing' || doc.robot?.state === 'revising') {
    reject('review_conflict', 'the proposal is changing · wait for it to finish');
  }

  switch (action.kind) {
    case 'approve':
      if (doc.review !== 'pending') reject('review_conflict', 'this lot is already with barbara · refresh to check');
      return { review: 'approved', reviewedAt: now, completed: false, completedAt: null };
    case 'feedback': {
      const note = action.note.trim();
      if (!note || note.length > 4000) reject('review_invalid', 'keep your instructions between 1 and 4000 characters');
      const slip: SlipEntry = { at: now, to: 'barbara', note, mode: action.mode };
      if (action.mode === 'voice' && Number.isFinite(action.secs)) slip.secs = Math.max(0, action.secs!);
      return {
        review: 'barbara', reviewedAt: now, feedback: note,
        slips: [...(doc.slips ?? []), slip].slice(-12),
        robot: null, completed: false, completedAt: null,
      };
    }
    case 'complete':
      if (!(doc.review === 'approved' || (doc.review === 'barbara' && doc.kind === 'manual'))) {
        reject('review_conflict', 'return a corrected proposal to carla before marking it handled');
      }
      return { completed: true, completedAt: now };
    case 'return': {
      if (!['approved', 'barbara', 'changes'].includes(doc.review)) reject('review_conflict', 'this lot is already back with carla');
      const proposal = action.proposal.trim();
      if (!proposal || proposal.length > 6000) reject('review_invalid', 'keep the proposal between 1 and 6000 characters');
      return {
        review: 'pending', reviewedAt: null, completed: false, completedAt: null,
        prevDraft: doc.draft ?? null,
        draft: {
          ...doc.draft, proposal, at: now, basis: 'revision',
          answering: doc.feedback || 'Barbara returned a revised proposal for your approval.',
        },
        robot: null, draftFail: null, autoFiled: false,
      };
    }
    case 'file':
      if (doc.review !== 'pending') reject('review_conflict', 'this lot is with barbara · reopen it first');
      return { completed: true, completedAt: now };
    case 'reopen':
      if (doc.review === 'pending' && !doc.completed) reject('review_conflict', 'this lot is already open');
      return { review: 'pending', completed: false, reviewedAt: null, completedAt: null, autoFiled: false };
  }
}
