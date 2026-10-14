import assert from 'node:assert/strict';
import test from 'node:test';
import { CURATED, flagsOf, isCurated, needsCarlaAction, readLot, toTask, type LotDoc, type Triage } from '../frontend/src/lib/inbox';
import { DEFAULT_CONFIG, read, urgentUndrafted } from '../frontend/src/lib/robot';
import type { Db, Sample } from '../frontend/src/lib/runtime';

const NOW = new Date('2026-10-14T12:00:00Z');
const AT = '2026-10-14T10:00:00Z';

function triage(patch: Partial<Triage> = {}): Triage {
  return {
    category: 'Finance', actionRequired: true, priority: 'High',
    nextAction: 'Follow up the payment',
    summary: 'The captain will collect payment; Fernanda is following up.',
    owner: 'Fernanda Brito',
    ...patch,
  };
}

function lot(patch: Partial<LotDoc> = {}): LotDoc {
  const doc = {
    v: 2 as const, lot: 1, kind: 'mail' as const, subject: 'Fixture cushions payment',
    mailbox: 'carla@example.test', senderEmail: 'captain@example.test',
    to: ['fernanda@example.test'], cc: ['carla@example.test'],
    lastInboundId: 'inbound-1', receivedAt: AT, createdAt: AT, updatedAt: AT,
    review: 'pending' as const, completed: false, triage: triage(),
    ...patch,
  };
  const decoded = readLot(JSON.parse(JSON.stringify({ ...doc, ...flagsOf(doc) })));
  assert.ok(decoded);
  return decoded;
}

test('finance follow-up explicitly assigned to another person is not a Carla task, even with stale work flags', () => {
  const doc = lot({ work: true, triage: triage({ actionFor: 'other' }) });
  assert.equal(doc.triage?.owner, 'Fernanda Brito', 'owner survives the persistence decoder');
  assert.equal(isCurated(doc), false);
  assert.equal(toTask('fixture', doc, NOW).prepared?.actionRequired, false);
  assert.deepEqual(urgentUndrafted([{ id: 'fixture', doc }], NOW, 3), []);
  assert.equal(doc.open, true, 'filtering must not archive or complete the correspondence');
  assert.equal(doc.completed, false);
  assert.equal(doc.read, true, 'show-all can still display the read correspondence');
  assert.equal(doc.work, true, 'finance correspondence keeps its existing retention policy');
});

test('a business category alone cannot turn information into a Carla task', () => {
  for (const category of CURATED) {
    const doc = lot({ triage: triage({ category, actionRequired: false, owner: undefined }) });
    assert.equal(isCurated(doc), false, category);
    assert.equal(toTask('fixture', doc, NOW).prepared?.actionRequired, false, category);
    assert.deepEqual(urgentUndrafted([{ id: 'fixture', doc }], NOW, 3), [], category);
  }
});

test('a real Carla decision remains visible and eligible for preparation', () => {
  const doc = lot({ triage: triage({ owner: 'Carla Cohen', nextAction: 'Approve the invoice before Fernanda proceeds' }) });
  assert.equal(isCurated(doc), true);
  assert.equal(toTask('fixture', doc, NOW).prepared?.actionRequired, true);
  assert.deepEqual(urgentUndrafted([{ id: 'fixture', doc }], NOW, 3).map((item) => item.id), ['fixture']);
});

test('legacy owner text never hides an actionable lot before structured reclassification', () => {
  for (const owner of [undefined, '', 'unknown', 'TBD', 'CG Design', 'Contas a Pagar', 'the studio', 'Studio Team', 'Finance Department', 'principal', 'Project Manager', 'Carla or Fernanda', 'Fernanda ou Maria', 'Fernanda Brito?', 'Fernanda', 'Fernanda Brito', 'Carla Cohen']) {
    const doc = lot({ triage: triage({ owner }) });
    assert.equal(doc.triage?.actionFor, undefined);
    assert.equal(isCurated(doc), true, String(owner));
    assert.equal(toTask('fixture', doc, NOW).prepared?.actionRequired, true, String(owner));
    assert.deepEqual(urgentUndrafted([{ id: 'fixture', doc }], NOW, 3).map((item) => item.id), ['fixture'], String(owner));
  }
});

test('structured assignment survives reading and takes precedence over legacy free-text names', () => {
  for (const actionFor of ['other', 'none'] as const) {
    const doc = lot({ triage: triage({ actionFor, owner: 'Carla' }) });
    assert.equal(doc.triage?.actionFor, actionFor);
    assert.equal(isCurated(doc), false);
    assert.equal(toTask('fixture', doc, NOW).prepared?.actionRequired, false);
  }
  for (const actionFor of ['carla', 'unclear'] as const) {
    const doc = lot({ triage: triage({ actionFor }) });
    assert.equal(doc.triage?.actionFor, actionFor);
    assert.equal(isCurated(doc), true);
  }
  const invalid = lot({ triage: triage({ owner: undefined, actionFor: 'unsupported' as Triage['actionFor'] }) });
  assert.equal(invalid.triage?.actionFor, undefined);
  assert.equal(isCurated(invalid), true, 'unknown schema values must use the conservative legacy fallback');
});

test('To, CC, sender and names in the summary are context, not assignment rules', () => {
  const forCarla = triage({ owner: 'Carla', summary: 'Fernanda Brito and the captain need Carla’s approval.' });
  const forSomeoneElse = triage({ actionFor: 'other' });
  for (const recipients of [
    { to: ['carla@example.test'], cc: [] },
    { to: ['fernanda@example.test'], cc: ['carla@example.test'] },
  ]) {
    assert.equal(isCurated(lot({ ...recipients, senderEmail: 'fernanda@example.test', triage: forCarla })), true);
    assert.equal(isCurated(lot({ ...recipients, senderEmail: 'carla@example.test', triage: forSomeoneElse })), false);
  }
});

test('manual work, human handoffs, returned proposals and archive history stay accessible', () => {
  const other = triage({ actionFor: 'other', actionRequired: false });
  for (const patch of [
    { kind: 'manual' as const },
    { review: 'barbara' as const },
    { review: 'approved' as const },
    { review: 'changes' as const },
    { slips: [{ at: AT, to: 'barbara' as const, note: 'Please follow up for me.' }] },
    { draft: { proposal: 'Revised proposal for Carla.', at: AT, basis: 'revision' as const } },
  ]) {
    const doc = lot({ triage: other, ...patch });
    assert.equal(isCurated(doc), true);
    assert.equal(toTask('fixture', doc, NOW).prepared?.actionRequired, true);
  }
  assert.equal(isCurated(lot({ triage: other, completed: true })), true);
});

async function runTriage(answer: Record<string, unknown>, patch: Partial<LotDoc> = {}) {
  const original = lot({ triage: null, ...patch });
  let saved = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
  let prompt = '';
  const db = {
    doc: (path: string) => {
      assert.equal(path, 'lots/fixture');
      return {
        get: async () => ({ exists: true, data: () => structuredClone(saved) }),
        update: async (value: Record<string, unknown>) => { saved = { ...saved, ...value }; },
      };
    },
  } as unknown as Db;
  const sample = Object.assign(async () => ({ text: '', truncated: false }), {
    json: async (input: string) => { prompt = input; return [{ id: 'fixture', ...answer }]; },
  }) as Sample;
  const result = await read({
    db, sample, signal: new AbortController().signal,
    config: { ...DEFAULT_CONFIG, mailbox: 'carla@example.test', roster: ['Captain <captain@example.test>'] },
  }, [{ id: 'fixture', doc: original }]);
  assert.equal(result.failure, null);
  assert.equal(result.read, 1);
  const decoded = readLot(saved);
  assert.ok(decoded);
  return { doc: decoded, prompt };
}

test('robot decoding and known-sender promotion cannot turn another person’s work into Carla’s', async () => {
  const { doc, prompt } = await runTriage({
    ...triage({ category: 'Newsletter / Information', actionFor: 'other' }),
  });
  assert.equal(doc.triage?.category, 'Project / Work', 'known correspondence still keeps studio context');
  assert.equal(doc.triage?.actionFor, 'other');
  assert.equal(doc.triage?.owner, 'Fernanda Brito');
  assert.equal(doc.triage?.actionRequired, false, 'inconsistent model output is normalized to the explicit assignment');
  assert.equal(isCurated(doc), false);
  assert.equal(toTask('fixture', doc, NOW).prepared?.actionRequired, false);
  assert.deepEqual(urgentUndrafted([{ id: 'fixture', doc }], NOW, 3), []);
  assert.match(prompt, /only when Carla herself/);
  assert.match(prompt, /to: fernanda@example\.test/);
  assert.match(prompt, /cc: carla@example\.test/);
});

test('new correspondence assigned to someone else does not reopen completed work', async () => {
  const { doc } = await runTriage({ ...triage(), actionFor: 'other' }, { completed: true, completedAt: AT });
  assert.equal(doc.completed, true);
  assert.equal(doc.open, false);
});

test('new explicit Carla action can reopen completed work', async () => {
  const { doc } = await runTriage({ ...triage({ owner: 'Carla', actionFor: 'carla' }) }, { completed: true, completedAt: AT });
  assert.equal(doc.completed, false);
  assert.equal(doc.open, true);
  assert.equal(needsCarlaAction(doc.triage), true);
});
