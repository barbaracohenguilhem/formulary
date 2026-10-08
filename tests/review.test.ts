import assert from 'node:assert/strict';
import test from 'node:test';
import { flagsOf, readLot, toTask, type LotDoc } from '../frontend/src/lib/inbox';
import { isBarbaraPending, reviewPatch } from '../frontend/src/lib/review';

const BEFORE = '2026-10-07T10:00:00.000Z';
const NOW = '2026-10-07T12:00:00.000Z';

function lot(patch: Partial<LotDoc> = {}): LotDoc {
  const doc = {
    v: 2 as const,
    lot: 12,
    kind: 'mail' as const,
    threadId: 'fixture-thread',
    mailbox: 'carla@example.test',
    senderEmail: 'client@example.test',
    subject: 'Confirm the presentation',
    receivedAt: BEFORE,
    createdAt: BEFORE,
    updatedAt: BEFORE,
    review: 'pending' as const,
    completed: false,
    triage: { category: 'Project / Work', actionRequired: true, priority: 'High', nextAction: 'Approve the presentation reply', summary: 'The client asks for the presentation.', fromName: 'Fixture Client' },
    draft: { nextAction: 'Approve the presentation reply', summary: 'The client asks for the presentation.', proposal: 'The presentation is ready for your review.', deliverable: 'Project presentation', at: BEFORE, basis: 'thread' as const },
    ...patch,
  };
  return { ...doc, ...flagsOf(doc) };
}

function apply(doc: LotDoc, actor: 'carla' | 'barbara' | null, action: Parameters<typeof reviewPatch>[2]): LotDoc {
  const patch = reviewPatch(doc, actor, action, NOW);
  const next = readLot(JSON.parse(JSON.stringify({ ...doc, ...patch })));
  assert.ok(next, 'the persisted document must be readable');
  return next;
}

const task = (doc: LotDoc) => toTask('fixture', doc, new Date(NOW));
const rejectsCode = (fn: () => unknown, code: string) => assert.throws(fn, (error: unknown) => (error as { code?: string }).code === code);

test('Carla approval is work for Barbara, not proof the action has been completed', () => {
  const original = lot();
  const approved = apply(original, 'carla', { kind: 'approve' });
  assert.equal(approved.review, 'approved');
  assert.equal(approved.open, false);
  assert.equal(approved.completed, false);
  assert.equal(approved.reviewedAt, NOW);
  assert.equal(task(approved).done, true, 'Carla has finished reviewing this lot');
  assert.equal(task(approved).prepared?.completed, false);
  assert.equal(isBarbaraPending(task(approved)), true);
  assert.equal(original.review, 'pending', 'transition must not mutate its input');
});

test('Barbara queue includes approvals, feedback, and legacy robot feedback but no pending or finished lots', () => {
  for (const review of ['approved', 'barbara', 'changes'] as const) {
    assert.equal(isBarbaraPending(task(lot({ review }))), true, review);
    assert.equal(isBarbaraPending(task(lot({ review, completed: true }))), false, `completed ${review}`);
  }
  assert.equal(isBarbaraPending(task(lot())), false);
  assert.equal(isBarbaraPending({ ...task(lot()), prepared: undefined }), false, 'seed tasks are not a real Barbara queue');
});

for (const mode of ['written', 'voice'] as const) {
  test(`${mode} feedback survives the real persistence decoder and task adapter`, () => {
    const next = apply(lot(), 'carla', { kind: 'feedback', note: '  Use the updated presentation from Tuesday.  ', mode, secs: mode === 'voice' ? 8 : undefined });
    assert.equal(next.review, 'barbara');
    assert.equal(next.completed, false);
    assert.equal(next.open, true);
    assert.equal(next.feedback, 'Use the updated presentation from Tuesday.');
    assert.equal(next.slips?.at(-1)?.note, next.feedback);
    assert.equal(next.slips?.at(-1)?.to, 'barbara');
    assert.equal(task(next).slip?.note, next.feedback);
    assert.equal(task(next).slip?.mode, mode);
    assert.equal(task(next).slip?.to, 'barbara');
    assert.equal(isBarbaraPending(task(next)), true);
    if (mode === 'voice') assert.equal(task(next).slip?.secs, 8);
  });
}

test('new feedback appends to the existing trail instead of replacing it', () => {
  const first = apply(lot(), 'carla', { kind: 'feedback', note: 'First correction.', mode: 'written' });
  const second = apply(first, 'carla', { kind: 'feedback', note: 'Also attach the presentation.', mode: 'written' });
  assert.deepEqual(second.slips?.map((slip) => slip.note), ['First correction.', 'Also attach the presentation.']);
});

test('a correction returned by Barbara goes back to Carla with its context and revision trail', () => {
  const waiting = apply(lot(), 'carla', { kind: 'feedback', note: 'Use the updated presentation.', mode: 'written' });
  const corrected = apply(waiting, 'barbara', { kind: 'return', proposal: '  Here is the updated presentation from Tuesday.  ' });
  assert.equal(corrected.review, 'pending');
  assert.equal(corrected.completed, false);
  assert.equal(corrected.open, true);
  assert.equal(corrected.draft?.proposal, 'Here is the updated presentation from Tuesday.');
  assert.equal(corrected.draft?.basis, 'revision');
  assert.equal(corrected.draft?.answering, waiting.feedback);
  assert.equal(corrected.draft?.deliverable, waiting.draft?.deliverable);
  assert.equal(corrected.draft?.summary, waiting.draft?.summary);
  assert.deepEqual(corrected.prevDraft, waiting.draft);
  assert.equal(corrected.slips?.length, 1);
  assert.equal(task(corrected).slip?.status, 'returned');
  assert.equal(task(corrected).prepared?.revised?.note, waiting.feedback);
  assert.equal(isBarbaraPending(task(corrected)), false);
});

test('returned proposal survives reload up to the documented 6000-character limit', () => {
  const next = apply(lot({ review: 'barbara', feedback: 'Expand the answer.' }), 'barbara', { kind: 'return', proposal: 'a'.repeat(6000) });
  assert.equal(next.draft?.proposal?.length, 6000);
  rejectsCode(() => reviewPatch(lot({ review: 'barbara' }), 'barbara', { kind: 'return', proposal: 'a'.repeat(6001) }, NOW), 'review_invalid');
});

test('Barbara completes an approved action and it leaves her queue', () => {
  const next = apply(lot({ review: 'approved', reviewedAt: BEFORE }), 'barbara', { kind: 'complete' });
  assert.equal(next.completed, true);
  assert.equal(next.review, 'approved');
  assert.equal(next.completedAt, NOW);
  assert.equal(next.reviewedAt, BEFORE);
  assert.equal(isBarbaraPending(task(next)), false);
});

test('Barbara can complete a delegated manual task without treating email feedback as completion', () => {
  assert.equal(apply(lot({ kind: 'manual', review: 'barbara' }), 'barbara', { kind: 'complete' }).completed, true);
  rejectsCode(() => reviewPatch(lot({ review: 'barbara' }), 'barbara', { kind: 'complete' }, NOW), 'review_conflict');
  rejectsCode(() => reviewPatch(lot({ review: 'changes' }), 'barbara', { kind: 'complete' }, NOW), 'review_conflict');
});

test('irrelevant mail is filed without being put in Barbara approval queue', () => {
  const next = apply(lot(), 'carla', { kind: 'file' });
  assert.equal(next.completed, true);
  assert.equal(next.review, 'pending');
  assert.equal(isBarbaraPending(task(next)), false);
});

test('reopening restores Carla review and removes stale completed state', () => {
  const next = apply(lot({ review: 'approved', completed: true, completedAt: BEFORE }), 'carla', { kind: 'reopen' });
  assert.equal(next.review, 'pending');
  assert.equal(next.completed, false);
  assert.equal(next.open, true);
  assert.equal(next.completedAt, undefined);
  assert.equal(isBarbaraPending(task(next)), false);
});

test('role boundaries are enforced before any transition patch can be persisted', () => {
  const approved = lot({ review: 'approved' });
  const waiting = lot({ review: 'barbara' });
  rejectsCode(() => reviewPatch(approved, 'carla', { kind: 'complete' }, NOW), 'review_forbidden');
  rejectsCode(() => reviewPatch(waiting, 'carla', { kind: 'return', proposal: 'Updated reply.' }, NOW), 'review_forbidden');
  rejectsCode(() => reviewPatch(lot(), 'barbara', { kind: 'approve' }, NOW), 'review_forbidden');
  rejectsCode(() => reviewPatch(lot(), 'barbara', { kind: 'feedback', note: 'Change it.', mode: 'written' }, NOW), 'review_forbidden');
  for (const action of [{ kind: 'approve' }, { kind: 'complete' }, { kind: 'file' }, { kind: 'reopen' }] as const) {
    rejectsCode(() => reviewPatch(approved, null, action, NOW), 'review_forbidden');
  }
});

test('stale or invalid decisions fail instead of silently overwriting workflow state', () => {
  rejectsCode(() => reviewPatch(lot({ completed: true }), 'carla', { kind: 'approve' }, NOW), 'review_conflict');
  rejectsCode(() => reviewPatch(lot(), 'barbara', { kind: 'complete' }, NOW), 'review_conflict');
  rejectsCode(() => reviewPatch(lot(), 'barbara', { kind: 'return', proposal: 'Updated reply.' }, NOW), 'review_conflict');
  rejectsCode(() => reviewPatch(lot({ review: 'barbara', completed: true }), 'barbara', { kind: 'return', proposal: 'Updated reply.' }, NOW), 'review_conflict');
  rejectsCode(() => reviewPatch(lot(), 'carla', { kind: 'feedback', note: '   ', mode: 'voice', secs: 12 }, NOW), 'review_invalid');
  rejectsCode(() => reviewPatch(lot({ review: 'barbara' }), 'barbara', { kind: 'return', proposal: '\n  ' }, NOW), 'review_invalid');
});
