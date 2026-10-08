// Offline integration test: real React UI and Supabase client, fictional data only.
// Every remote HTTP/WebSocket request is intercepted before it can leave the browser.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const API = 'https://formulary-test.invalid';
const timestamp = new Date(Date.now() - 3600_000).toISOString();
const docs = new Map();
const commits = [];
const apiCalls = [];
const unexpected = [];
const pageErrors = [];
let failWrites = false;

function lot(id, number, title, patch = {}) {
  const doc = {
    v: 2, kind: 'mail', lot: number, subject: title, senderEmail: 'client@example.test', mailbox: 'carla@example.test',
    receivedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    review: 'pending', completed: false, open: true, work: true, read: true,
    triage: { category: 'Project / Work', actionRequired: true, priority: 'High', nextAction: title, summary: `Briefing for ${title}`, fromName: 'Fixture Client' },
    draft: { proposal: `Prepared reply for ${title}`, at: timestamp, basis: 'thread' },
    ...patch,
  };
  doc.open = !doc.completed && doc.review !== 'approved';
  docs.set(`lots/${id}`, doc);
}

lot('approve', 1, 'approve presentation delivery');
lot('feedback', 2, 'correct the schedule reply');
lot('dictated', 3, 'dictate a presentation correction');
lot('pending', 4, 'unreviewed private briefing');
lot('legacy', 5, 'legacy feedback for barbara', { review: 'changes', feedback: 'Please use Tuesday.', slips: [{ at: timestamp, to: 'the robot', note: 'Please use Tuesday.' }] });
lot('finished', 6, 'already completed action', { review: 'approved', completed: true, completedAt: timestamp, closedAt: timestamp });
lot('old-approval', 7, 'older approval still waiting', { review: 'approved', reviewedAt: '2020-01-01T12:00:00.000Z', closedAt: '2020-01-01T12:00:00.000Z' });
lot('checkbox', 8, 'row checkbox decision');
lot('fallback', 9, 'written fallback instructions');
// More than the ordinary archive limit proves Barbara's queue is queried independently.
for (let i = 0; i < 205; i++) lot(`archive-${i}`, 100 + i, `archive fixture ${i}`, { review: 'approved', completed: true, completedAt: timestamp, closedAt: timestamp });
docs.set('meta/robot', { mailbox: 'carla@example.test', signature: 'Carla', notes: 'Fixture only: never send.' });

const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
const value = (doc, key) => doc[({ received_at: 'receivedAt', closed_at: 'closedAt', completed_at: 'completedAt' })[key] ?? key];

async function fixtureRoute(route, who) {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin === origin) return route.continue();
  if (url.origin !== API) {
    // External webfonts are cosmetic; all external requests remain blocked.
    if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) unexpected.push(request.url());
    return route.abort('blockedbyclient');
  }
  apiCalls.push({ who, path: url.pathname, query: url.search, method: request.method() });
  if (url.pathname === '/rest/v1/people') return json(route, [{ who }]);
  if (url.pathname === '/rest/v1/devices') return json(route, []);
  if (url.pathname === '/rest/v1/docs' && request.method() === 'GET') {
    let rows = [...docs].map(([path, doc]) => ({ path, doc }));
    for (const [key, filter] of url.searchParams) {
      if (!filter.startsWith('eq.')) continue;
      const wanted = filter.slice(3);
      rows = rows.filter(({ path, doc }) => String(key === 'path' ? path : key === 'collection' ? path.split('/').slice(0, -1).join('/') : value(doc, key)) === wanted);
    }
    const order = url.searchParams.get('order');
    if (order) {
      const [column, direction] = order.split('.');
      rows.sort((a, b) => String(value(a.doc, column) ?? '').localeCompare(String(value(b.doc, column) ?? '')) * (direction === 'desc' ? -1 : 1));
    }
    rows = rows.slice(0, Number(url.searchParams.get('limit') ?? rows.length));
    const single = request.headers().accept?.includes('application/vnd.pgrst.object+json');
    return json(route, single ? rows[0] ?? null : rows);
  }
  if (url.pathname === '/rest/v1/rpc/doc_merge') {
    if (failWrites) return json(route, { code: 'NETWORK_DOWN', message: 'fixture network failure' }, 503);
    const body = request.postDataJSON();
    const old = docs.get(body.p_path);
    assert.ok(old, 'updates must target an existing fixture');
    const next = { ...old, ...body.p_patch };
    docs.set(body.p_path, next);
    commits.push({ who, path: body.p_path, patch: body.p_patch });
    return json(route, next);
  }
  if (url.pathname === '/functions/v1/robot') {
    const action = request.postDataJSON().action;
    assert.equal(action, 'status', 'offline test must never run the robot');
    return json(route, { gmail: { connected: false, email: '' }, claude: false, google: true, unread: 0, mailbox: 'carla@example.test' });
  }
  unexpected.push(`${request.method()} ${url.pathname}`);
  return json(route, { message: 'unexpected fixture request' }, 500);
}

const server = await createServer({
  configFile: false,
  root: resolve('frontend'),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 0 },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(API),
    'import.meta.env.VITE_SUPABASE_KEY': JSON.stringify('fixture-public-key'),
  },
});
await server.listen();
const address = server.httpServer.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;

async function member(who, { dictation = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', (route) => fixtureRoute(route, who));
  await context.routeWebSocket('**/*', (socket) => socket.close());
  await context.addInitScript(({ who, token, dictation }) => {
    localStorage.setItem('formulary.auth', JSON.stringify({
      access_token: token, refresh_token: `fixture-refresh-${who}`, token_type: 'bearer',
      expires_at: 4102444800, expires_in: 31536000,
      user: { id: `fixture-${who}`, aud: 'authenticated', role: 'authenticated', email: `${who}@example.test` },
    }));
    // Browser dictation is tested as text transport, without opening a microphone.
    class FixtureSpeechRecognition {
      static latest;
      constructor() { FixtureSpeechRecognition.latest = this; }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    window.SpeechRecognition = dictation ? FixtureSpeechRecognition : undefined;
    window.webkitSpeechRecognition = undefined;
    window.__dictateFixture = (transcript) => {
      const result = [{ transcript }];
      result.isFinal = true;
      FixtureSpeechRecognition.latest.onresult({ resultIndex: 0, results: [result] });
    };
  }, { who, dictation, token: `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: `fixture-${who}`, exp: 4102444800, role: 'authenticated' })).toString('base64url')}.fixture` });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (error) => pageErrors.push(`${who}: ${error.message}`));
  await page.goto(origin);
  return page;
}

async function present(locator) { await locator.waitFor({ state: 'visible' }); }
async function refresh(page) { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); }
async function capture(page, name) {
  if (!process.env.FORMULARY_SCREENSHOTS) return;
  const directory = resolve(process.env.FORMULARY_SCREENSHOTS);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true, animations: 'disabled' });
}
async function stored(id, predicate) {
  const deadline = Date.now() + 10_000;
  while (!predicate(docs.get(`lots/${id}`))) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for saved ${id}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

try {
  // Reuse a local browser when the exact Playwright download is not present.
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find((path) => path && existsSync(path));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const carla = await member('carla');
  const barbara = await member('barbara');
  await present(carla.getByRole('button', { name: 'approve presentation delivery', exact: true }));
  await present(barbara.getByRole('heading', { name: 'from carla' }));
  await present(barbara.getByRole('button', { name: /older approval still waiting/ }));
  await present(barbara.getByRole('button', { name: /legacy feedback for barbara/ }));
  assert.equal(await barbara.getByText('unreviewed private briefing', { exact: true }).count(), 0);
  assert.equal(await barbara.getByText('already completed action', { exact: true }).count(), 0);
  assert.equal(await barbara.getByRole('button', { name: /approve presentation delivery/ }).count(), 0);
  assert.equal(await barbara.getByRole('button', { name: /connect gmail/i }).count(), 0);
  await capture(carla, '01-carla-initial');
  await capture(barbara, '02-barbara-initial');
  console.log('PASS: authenticated Carla and Barbara get different views; old approvals survive archive limits');

  assert.equal(await carla.getByRole('button', { name: 'mark as handled' }).count(), 0);
  // The hero's quick approval must use the same persisted handoff as the detail action.
  await carla.getByRole('button', { name: 'approve for barbara', exact: true }).click();
  await stored('approve', (doc) => doc.review === 'approved');
  assert.equal(docs.get('lots/approve').completed, false);
  await refresh(barbara);
  await barbara.getByRole('button', { name: /approve presentation delivery/ }).click();
  await present(barbara.getByText('Prepared reply for approve presentation delivery', { exact: true }));
  assert.equal(await barbara.getByRole('button', { name: 'approve for barbara', exact: true }).count(), 0);
  await barbara.getByRole('button', { name: 'mark as handled', exact: true }).click();
  await stored('approve', (doc) => doc.completed);
  await barbara.reload();
  await present(barbara.getByRole('heading', { name: 'from carla' }));
  assert.equal(await barbara.getByRole('button', { name: /approve presentation delivery/ }).count(), 0);
  console.log('PASS: approval hands over a visible proposal; Barbara completion removes it after reload');

  await carla.reload();
  await carla.getByRole('button', { name: /correct the schedule reply/ }).click();
  await carla.getByRole('button', { name: 'give feedback to barbara', exact: true }).click();
  await carla.getByRole('button', { name: 'written', exact: true }).click();
  const beforeCancel = commits.length;
  await carla.getByRole('textbox', { name: 'feedback for barbara' }).fill('Cancel this unfinished feedback.');
  await carla.getByRole('button', { name: '← cancel', exact: true }).click();
  await present(carla.getByRole('button', { name: 'give feedback to barbara', exact: true }));
  assert.equal(commits.length, beforeCancel, 'cancelling feedback must not write');
  await carla.getByRole('button', { name: 'give feedback to barbara', exact: true }).click();
  await carla.getByRole('button', { name: 'written', exact: true }).click();
  await carla.getByRole('textbox', { name: 'feedback for barbara' }).fill('Use Tuesday afternoon, not Monday.');
  failWrites = true;
  await carla.getByRole('button', { name: 'send feedback to barbara →', exact: true }).click();
  await present(carla.getByText(/couldn’t confirm the save|not saved/i).first());
  assert.equal(docs.get('lots/feedback').review, 'pending');
  assert.equal(commits.length, beforeCancel);
  assert.equal(await carla.getByRole('textbox', { name: 'feedback for barbara' }).inputValue(), 'Use Tuesday afternoon, not Monday.');
  failWrites = false;
  await carla.getByRole('button', { name: 'send feedback to barbara →', exact: true }).click();
  await stored('feedback', (doc) => doc.review === 'barbara');
  await carla.reload();
  await present(carla.getByRole('checkbox', { name: 'correct the schedule reply is with barbara', exact: true }));
  assert.equal(await carla.getByRole('checkbox', { name: 'correct the schedule reply is with barbara', exact: true }).isDisabled(), true);
  await present(carla.locator('section').filter({ has: carla.getByRole('button', { name: 'dictate a presentation correction', exact: true }) }));
  console.log('PASS: cancelling feedback writes nothing; failed feedback keeps text; handoff advances Carla’s hero');
  await refresh(barbara);
  await barbara.getByRole('button', { name: /correct the schedule reply/ }).click();
  await present(barbara.getByText('Use Tuesday afternoon, not Monday.', { exact: true }));
  assert.equal(await barbara.getByRole('button', { name: 'mark as handled', exact: true }).count(), 0);
  await capture(barbara, '03-barbara-written-feedback-detail');
  await barbara.getByRole('button', { name: 'edit proposal for carla', exact: true }).click();
  await barbara.getByRole('textbox', { name: 'proposal for carla to review' }).fill('Tuesday afternoon works. See you then, Carla.');

  failWrites = true;
  await barbara.getByRole('button', { name: 'return proposal to carla →', exact: true }).click();
  await present(barbara.getByText(/couldn’t confirm the save|not saved|couldn’t return/i).first());
  assert.equal(docs.get('lots/feedback').review, 'barbara');
  assert.equal(await barbara.getByRole('textbox', { name: 'proposal for carla to review' }).inputValue(), 'Tuesday afternoon works. See you then, Carla.');
  failWrites = false;
  await barbara.getByRole('button', { name: 'return proposal to carla →', exact: true }).click();
  await stored('feedback', (doc) => doc.review === 'pending');
  await carla.reload();
  await carla.getByRole('button', { name: /correct the schedule reply/ }).click();
  await present(carla.getByText('Tuesday afternoon works. See you then, Carla.', { exact: true }));
  await present(carla.getByRole('button', { name: 'approve for barbara', exact: true }));
  await barbara.reload();
  await present(barbara.getByRole('heading', { name: 'from carla' }));
  assert.equal(await barbara.getByRole('button', { name: /correct the schedule reply/ }).count(), 0);
  console.log('PASS: feedback, recoverable save failure, correction, and return for Carla approval');

  await carla.reload();
  await carla.getByRole('button', { name: /dictate a presentation correction/ }).click();
  await carla.getByRole('button', { name: 'give feedback to barbara', exact: true }).click();
  await carla.getByRole('button', { name: 'start dictation', exact: true }).click();
  await carla.evaluate(() => window.__dictateFixture('Please attach the revised presentation.'));
  await carla.getByRole('button', { name: 'stop', exact: true }).click();
  await carla.getByRole('button', { name: 'send feedback to barbara →', exact: true }).click();
  await stored('dictated', (doc) => doc.review === 'barbara');
  assert.equal(docs.get('lots/dictated').slips.at(-1).mode, 'voice');
  assert.equal(docs.get('lots/dictated').feedback, 'Please attach the revised presentation.');
  await barbara.reload();
  await present(barbara.getByText('dictated feedback · transcript', { exact: true }));
  await present(barbara.getByText('Please attach the revised presentation.', { exact: true }));
  await capture(barbara, '04-barbara-queue-with-dictation');
  console.log('PASS: dictated feedback reaches Barbara as a persisted transcript');

  const noVoiceCarla = await member('carla', { dictation: false });
  await noVoiceCarla.getByRole('button', { name: /written fallback instructions/ }).click();
  await noVoiceCarla.getByRole('button', { name: 'give feedback to barbara', exact: true }).click();
  assert.equal(await noVoiceCarla.getByRole('button', { name: 'start dictation', exact: true }).count(), 0);
  await noVoiceCarla.getByRole('textbox', { name: 'feedback for barbara' }).fill('Written feedback without speech support.');
  await noVoiceCarla.getByRole('button', { name: 'send feedback to barbara →', exact: true }).click();
  await stored('fallback', (doc) => doc.review === 'barbara');
  assert.equal(docs.get('lots/fallback').slips.at(-1).mode, 'written');
  await noVoiceCarla.context().close();
  console.log('PASS: missing browser speech support falls back to persisted written feedback');

  const beforeConcurrent = commits.length;
  await barbara.getByRole('button', { name: /legacy feedback for barbara/ }).click();
  await barbara.getByRole('button', { name: 'edit proposal for carla', exact: true }).click();
  await barbara.getByRole('textbox', { name: 'proposal for carla to review' }).fill('Keep my unsaved local revision.');
  docs.get('lots/legacy').updatedAt = new Date(Date.now() + 2000).toISOString();
  docs.get('lots/legacy').draft.proposal = 'A newer proposal from another device.';
  await refresh(barbara);
  await present(barbara.getByRole('alert').filter({ hasText: 'This lot changed while you were editing.' }));
  assert.equal(await barbara.getByRole('textbox', { name: 'proposal for carla to review' }).inputValue(), 'Keep my unsaved local revision.');
  assert.equal(await barbara.getByRole('button', { name: 'return proposal to carla →', exact: true }).isDisabled(), true);
  assert.equal(commits.length, beforeConcurrent);
  await capture(barbara, '05-barbara-editor-conflict');
  await barbara.getByRole('button', { name: 'cancel editing', exact: true }).click();
  await barbara.getByRole('button', { name: 'edit proposal for carla', exact: true }).click();
  assert.equal(await barbara.getByRole('textbox', { name: 'proposal for carla to review' }).inputValue(), 'A newer proposal from another device.');
  await barbara.getByRole('textbox', { name: 'proposal for carla to review' }).fill('Keep this second unsaved revision too.');
  docs.get('lots/legacy').review = 'pending';
  docs.get('lots/legacy').updatedAt = new Date(Date.now() + 3000).toISOString();
  await refresh(barbara);
  await present(barbara.getByRole('alert').filter({ hasText: 'This lot is back with Carla for review.' }));
  assert.equal(await barbara.getByRole('textbox', { name: 'proposal for carla to review' }).inputValue(), 'Keep this second unsaved revision too.');
  assert.equal(await barbara.getByRole('button', { name: 'return proposal to carla →', exact: true }).isDisabled(), true);
  assert.equal(commits.length, beforeConcurrent, 'realtime changes must not overwrite or auto-save the local editor');
  await barbara.getByRole('button', { name: 'cancel editing', exact: true }).click();
  await present(barbara.getByRole('status').filter({ hasText: 'This lot is back with Carla for review.' }));
  assert.equal(commits.length, beforeConcurrent, 'cancelling the proposal editor must not write');
  console.log('PASS: concurrent updates preserve local draft, disable stale save, and keep a detail that left the queue');

  await carla.reload();
  await carla.getByRole('checkbox', { name: 'approve row checkbox decision for barbara', exact: true }).click();
  await stored('checkbox', (doc) => doc.review === 'approved');
  assert.equal(docs.get('lots/checkbox').completed, false);
  console.log('PASS: list checkbox approval creates a handoff without completing it');

  const beforeStale = commits.length;
  await carla.reload();
  await carla.getByRole('button', { name: /unreviewed private briefing/ }).click();
  docs.get('lots/pending').updatedAt = new Date(Date.now() + 1000).toISOString();
  docs.get('lots/pending').draft.proposal = 'Changed by another device.';
  await carla.getByRole('button', { name: 'approve for barbara', exact: true }).click();
  await present(carla.getByText(/changed|updated|refresh.*check|review.*again/i).first());
  assert.equal(commits.length, beforeStale, 'stale approval must not be persisted');
  assert.equal(docs.get('lots/pending').review, 'pending');
  console.log('PASS: stale decision is rejected before writing');

  assert.deepEqual(unexpected, [], 'all API usage must remain in the offline fixture contract');
  assert.deepEqual(pageErrors, [], 'no unhandled browser errors');
  assert.equal(apiCalls.some((call) => call.who === 'barbara' && call.path.startsWith('/functions/v1/')), false, 'Barbara must not run or depend on the robot');
  assert.equal(commits.filter((commit) => commit.who === 'carla').length, 5);
  assert.equal(commits.filter((commit) => commit.who === 'barbara').length, 2);
  console.log(`PASS: ${commits.length} expected writes, no real backend/Gmail traffic, no browser errors`);
} finally {
  await browser?.close();
  await server.close();
}
