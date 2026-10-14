import assert from 'node:assert/strict';
import test from 'node:test';
import { gmailLink, gmailMailbox } from '../frontend/src/lib/gmailLink';
import { threadOf } from '../frontend/src/lib/gmail';
import { readLot, toTask } from '../frontend/src/lib/inbox';

const mailbox = 'carla@example.test';
const threadId = '19aa000000000001';
const target = `https://mail.google.com/mail/?authuser=carla%40example.test#all/${threadId}`;

test('a generic Gmail URL becomes the stored thread in its own mailbox', () => {
  for (const gmail of [undefined, 'https://mail.google.com/mail/', 'https://mail.google.com/mail/u/0/#inbox', 'https://mail.google.com/mail/u/0/#search/Embrace']) {
    assert.equal(gmailLink({ gmail, threadId, mailbox }), target);
  }
});

test('a specific connector permalink keeps its thread and selects the lot mailbox', () => {
  const gmail = `https://mail.google.com/mail/?authuser=carla%40example.test#all/${threadId}`;
  assert.equal(gmailLink({ gmail, mailbox }), gmail);
  assert.equal(gmailLink({ gmail: 'https://mail.google.com/mail/u/0/?authuser=barbara%40example.test#inbox/FMfcgzQXthread', mailbox }),
    'https://mail.google.com/mail/?authuser=carla%40example.test#inbox/FMfcgzQXthread');
  assert.equal(gmailLink({ gmail: `https://mail.google.com/mail/u/2/?view=pt&search=all&th=${threadId}`, mailbox }), target);
});

test('a specific existing link can retain its known account when no lot mailbox exists', () => {
  assert.equal(gmailLink({ gmail: `https://mail.google.com/mail/u/2/#all/${threadId}` }), `https://mail.google.com/mail/u/2/#all/${threadId}`);
  assert.equal(gmailLink({ gmail: 'https://mail.google.com/mail/?authuser=carla%40example.test#inbox', threadId }), target);
});

test('a stale comparable thread target is replaced by the stored API thread ID', () => {
  for (const gmail of [
    'https://mail.google.com/mail/u/0/#inbox/19bb000000000002',
    'https://mail.google.com/mail/?authuser=barbara%40example.test&th=19bb000000000002',
  ]) {
    assert.equal(gmailLink({ gmail, threadId, mailbox }), target);
  }
  assert.equal(gmailLink({ gmail: 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQXthread', threadId, mailbox }),
    'https://mail.google.com/mail/?authuser=carla%40example.test#inbox/FMfcgzQXthread', 'a Gmail UI ID cannot be compared with an API ID');
});

test('no specific source means no Open in Gmail target', () => {
  for (const gmail of [undefined, 'https://mail.google.com/mail/', 'https://mail.google.com/mail/u/0/#inbox', 'https://mail.google.com/mail/#search/Embrace', 'https://mail.google.com/mail/?view=cm&to=someone@example.test']) {
    assert.equal(gmailLink({ gmail, mailbox }), undefined);
  }
  for (const id of ['', '<message@example.test>', 'message@example.test', 'g-19aa000000000001', 'fixture-thread', '../inbox']) {
    assert.equal(gmailLink({ threadId: id, mailbox }), undefined);
  }
  assert.equal(gmailLink({ threadId }), undefined, 'a fallback cannot guess the mailbox');
});

test('untrusted origins, credentials, paths, and malformed values cannot supply a target', () => {
  for (const gmail of [
    `https://mail.google.com.evil.test/mail/#all/${threadId}`,
    `https://mail.google.com@evil.test/mail/#all/${threadId}`,
    `https://evil.test@mail.google.com/mail/#all/${threadId}`,
    `http://mail.google.com/mail/#all/${threadId}`,
    `https://mail.google.com:8443/mail/#all/${threadId}`,
    `https://mail.google.com/elsewhere/#all/${threadId}`,
    `https://mail.google.com/mail/\\#all/${threadId}`,
    `https://mail.google.com/mail/\n#all/${threadId}`,
    'javascript:alert(1)',
  ]) {
    assert.equal(gmailLink({ gmail, mailbox }), undefined, gmail);
    assert.equal(gmailLink({ gmail, threadId, mailbox }), target, 'a trusted stored thread can replace an untrusted URL');
  }
  assert.equal(gmailLink({ threadId, mailbox: 'carla@example.test#inbox' }), undefined);
});

test('mailbox extraction never trusts a foreign host or throws on bad encoding', () => {
  assert.equal(gmailMailbox('https://mail.google.com/mail/?authuser=CARLA%40EXAMPLE.TEST#inbox'), mailbox);
  assert.equal(gmailMailbox('https://evil.test/?authuser=carla@example.test'), '');
  assert.equal(gmailMailbox('https://mail.google.com/mail/?authuser=%E0%A4%A'), '');
  assert.equal(gmailMailbox('https://mail.google.com/mail/?authuser=0'), '');
});

test('connector ingestion preserves the mailbox and repairs a generic source link', () => {
  const thread = threadOf({ id: threadId, viewUrl: 'https://mail.google.com/mail/?authuser=carla%40example.test#inbox', messages: [{ id: 'message', subject: 'Example', labelIds: [] }] });
  assert.equal(thread?.viewUrl, target);
  assert.equal(thread?.mailbox, mailbox);
  assert.equal(thread?.threadId, threadId);
});

test('reading a stored lot gives every UI entry point the same exact source target', () => {
  const data = {
    v: 2, kind: 'mail', subject: 'Fictional source email', senderEmail: 'sender@example.test',
    mailbox, threadId, gmail: 'https://mail.google.com/mail/u/0/#inbox',
    receivedAt: '2026-10-13T10:00:00.000Z',
  };
  const doc = readLot(data);
  assert.ok(doc);
  const task = toTask('fictional-source', doc);
  assert.equal(task.action?.target, target);
  assert.equal(task.prepared?.gmail, target);
  assert.ok(task.refs.length > 0);
  assert.ok(task.refs.every((ref) => ref.source?.url === target));

  const missing = readLot({ ...data, threadId: undefined });
  assert.ok(missing);
  const unavailable = toTask('fictional-missing-source', missing);
  assert.equal(unavailable.action, undefined);
  assert.equal(unavailable.prepared?.gmail, undefined);
  assert.ok(unavailable.refs.every((ref) => ref.source?.url === undefined));
});
