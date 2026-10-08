/*
 * Development only. Open the dev server at `/#inbox` and the app boots as if inside
 * claude.ai, against stand-ins for the three things the inbox uses:
 *
 *   db     — an in-memory store with where/orderBy/limit, live onSnapshot and leases,
 *            kept in localStorage so a reload keeps the lots (`#inbox?reset=1` clears it)
 *   mcp    — a "Gmail" connector over fictional threads, shaped like the real one
 *   sample — a "Claude" that answers triage and draft prompts from the fixture's hints
 *
 * Switches, read on every call: `?fail=gmail:<code>`, `?fail=claude:<code>`,
 * `?fail=store:<code>` (writes), `?owner=0` (a non-owner viewer), `?write=0` (read-only),
 * `?nomailbox=1` (studio notes without a mailbox), `?slow=<ms>` (Claude latency),
 * `?connect=<ms>` (a slow viewer). Never in a production build.
 */

type Json = Record<string, unknown>;

const params = () => {
  const h = location.hash;
  return new URLSearchParams(h.includes('?') ? h.slice(h.indexOf('?') + 1) : '');
};
const fail = (source: string) => {
  const f = params().get('fail') || '';
  return f.startsWith(`${source}:`) ? f.slice(source.length + 1) : '';
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reject = (code: string, retryable = false) => Promise.reject({ code, message: `stub: ${code}`, retryable });

/* ——— the mailbox: fictional threads, dated relative to now ——— */

const BOX = 'studio@example.test';
const H = 3600_000;
type Msg = { id: string; from: string; to: string[]; cc?: string[]; hoursAgo: number; subject: string; body: string; sent?: boolean; draft?: boolean };
type Hint = { triage: Json; draft?: Json };
type Thread = { id: string; messages: Msg[]; hint: Hint };

const day = (offset: number, hh?: number) => {
  const d = new Date(Date.now() + offset * 86400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return hh == null ? date : `${date}T${p(hh)}:00`;
};

const THREADS: Thread[] = [
  {
    id: '19aa000000000001',
    messages: [
      { id: 'm1', from: 'nora@ateliernord.test', to: [BOX], hoursAgo: 5, subject: 'Brass samples for the galley', body: 'Hello Carla,\nWe sent three brass finish samples for the galley hardware — satin, brushed and polished. Which should we run for the full batch? The foundry closes the batch on Friday.\nBest, Nora Lindqvist — Atelier Nord' },
    ],
    hint: {
      triage: { category: 'Project / Work', actionRequired: true, priority: 'High', nextAction: 'Choose the brass finish for the galley hardware before the foundry closes the batch', summary: 'Atelier Nord sent three brass finish samples and needs a choice before the foundry closes the batch on Friday.', project: 'Forte 1801', owner: 'Carla', fromName: 'Nora Lindqvist — Atelier Nord', dueAt: day(3), risk: null },
      draft: { nextAction: 'Approve the satin brass finish for the galley hardware', summary: 'Three finishes were sampled; the satin matches the reference board. The batch closes Friday.', deliverable: 'A finish choice for the full batch', proposal: 'Dear Nora,\n\nThank you for the samples. Please run the satin finish for the full batch — the brushed one reads too cold against the oak. Could you confirm the lead time once the order is in?\n\nBest,\nCarla', blockers: null, priority: 'High', dueAt: day(3), risk: null },
    },
  },
  {
    id: '19aa000000000002',
    messages: [
      { id: 'm2', from: 'accounts@cornice-billing.test', to: [BOX], hoursAgo: 20, subject: 'Invoice 2026-118 — updated bank details', body: 'Dear client,\nPlease note our bank details have changed. Kindly settle invoice 2026-118 to the new IBAN below by tomorrow.\nIBAN XX00 0000 0000 0000' },
    ],
    hint: {
      triage: { category: 'Finance', actionRequired: true, priority: 'High', nextAction: 'Verify the framer’s new bank details by phone before paying invoice 2026-118', summary: 'A message asks for invoice 2026-118 to be paid to new bank details by tomorrow.', project: null, owner: 'Barbara', fromName: 'Cornice billing', dueAt: day(1), risk: 'asks to pay an invoice to new bank details' },
    },
  },
  {
    id: '19aa000000000003',
    messages: [
      { id: 'm3', from: 'iris@haldenbuild.test', to: [BOX], cc: ['meg@example.test'], hoursAgo: 30, subject: 'Site visit — Thursday', body: 'Hi Carla, can we do the joinery site visit on Thursday at 10:00? Please confirm by Wednesday. — Iris Adebayo, Halden Build' },
      { id: 'm3b', from: BOX, to: ['iris@haldenbuild.test'], hoursAgo: 26, subject: 'Re: Site visit — Thursday', body: 'Checking the calendar, back to you shortly.', sent: true },
    ],
    hint: {
      triage: { category: 'Scheduling', actionRequired: true, priority: 'Medium', nextAction: 'Confirm the Thursday 10:00 joinery site visit with Halden Build', summary: 'Halden Build proposes the joinery site visit on Thursday at 10:00 and asks for confirmation by Wednesday.', project: 'Acqualina', owner: 'Carla', fromName: 'Iris Adebayo — Halden Build', dueAt: day(2), risk: null },
      draft: { nextAction: 'Confirm the Thursday 10:00 site visit', summary: 'The contractor proposed Thursday 10:00; the studio said it would check the calendar.', deliverable: null, proposal: 'Hi Iris,\n\nThursday at 10:00 works for us — see you on site.\n\nBest,\nCarla', blockers: null, priority: 'Medium', dueAt: day(2), risk: null },
    },
  },
  {
    id: '19aa000000000004',
    messages: [
      { id: 'm4', from: 'no-reply@platform.test', to: [BOX], hoursAgo: 8, subject: 'Your login from a new device', body: 'We noticed a login from a new device. If this was you, no action is needed.' },
    ],
    hint: { triage: { category: 'System / Notification', actionRequired: false, priority: 'No priority', nextAction: 'No action required.', summary: 'Routine login notification.', risk: null } },
  },
  {
    id: '19aa000000000005',
    messages: [
      { id: 'm5', from: 'lea@fontaineceramics.test', to: [BOX], hoursAgo: 40, subject: 'Introduction — ceramic lighting', body: 'Hello, I make ceramic pendant lights for residential projects and would love to share our catalogue. — Léa Fontaine' },
    ],
    hint: { triage: { category: 'Client / Sales', actionRequired: false, priority: 'Low', nextAction: 'Decide whether to reply to the ceramic lighting introduction', summary: 'A ceramicist introduces a range of pendant lights. No request beyond the introduction.', fromName: 'Léa Fontaine', risk: null } },
  },
  {
    id: '19aa000000000006',
    messages: [
      { id: 'm6', from: 'digest@designweekly.test', to: [BOX], hoursAgo: 12, subject: 'This week in design', body: 'The week’s round-up of projects and openings.' },
    ],
    hint: { triage: { category: 'Newsletter / Information', actionRequired: false, priority: 'No priority', nextAction: 'No action required.', summary: 'A weekly design newsletter.', risk: null } },
  },
  {
    id: '19aa000000000007',
    messages: [
      { id: 'm7', from: 'natalia@ornare.test', to: [BOX], hoursAgo: 3, subject: 'Shop drawings rev B', body: 'Attached the revised shop drawings for the dressing room. Which bedrooms take mirrored doors? We need your marked-up PDF to proceed.' },
      { id: 'm7d', from: BOX, to: ['natalia@ornare.test'], hoursAgo: 1, subject: 'Re: Shop drawings rev B', body: '(unsent draft)', draft: true },
    ],
    hint: {
      triage: { category: 'Project / Work', actionRequired: true, priority: 'Medium', nextAction: 'Mark up shop drawings rev b with the mirror-door bedrooms', summary: 'The joiner sent revised dressing-room shop drawings and needs the mirrored-door bedrooms marked up.', project: 'Acqualina', owner: 'Carla', fromName: 'Natalia Souza — Ornare', dueAt: null, risk: null },
      draft: { nextAction: 'Mark up rev B with the mirror-door bedrooms', summary: 'Rev B of the dressing-room drawings needs the mirrored-door bedrooms marked.', deliverable: 'Marked-up PDF of rev B with the mirror-door bedrooms circled', proposal: null, blockers: 'Unable to complete: the robot can’t see which bedrooms take mirrored doors — Carla must mark them on the PDF.', priority: 'Medium', dueAt: null, risk: null },
    },
  },
];

const threadOf = (t: Thread) => ({
  id: t.id,
  viewUrl: params().get('nomailbox') === 'wrong' ? `https://mail.google.com/mail/?authuser=someone@else.test#all/${t.id}` : `https://mail.google.com/mail/?authuser=${BOX}#all/${t.id}`,
  messages: t.messages.map((m) => {
    const at = Date.now() - m.hoursAgo * H;
    return {
      id: m.id,
      threadId: t.id,
      date: new Date(at).toISOString(),
      internalDate: String(at),
      labelIds: [...(m.sent ? ['SENT'] : ['INBOX']), ...(m.draft ? ['DRAFT'] : [])],
      sender: m.from,
      subject: m.subject,
      snippet: m.body.slice(0, 180).replace(/'/g, '&#39;'),
      toRecipients: m.to,
      ccRecipients: m.cc ?? [],
      viewUrl: `https://mail.google.com/mail/?authuser=${BOX}#all/${t.id}`,
      htmlBody: `<div>${m.body.replace(/\n/g, '<br>')}</div><img src="x" onerror="window.__pwned=true">`,
    };
  }),
});

const mcp = {
  callTool: async (server: string, tool: string, input: unknown) => {
    await wait(250);
    const f = fail('gmail');
    if (f) return reject(f, f === 'server_unavailable');
    if (server !== 'Gmail') return reject('not_in_manifest');
    const a = (input ?? {}) as Json;
    if ('maxResults' in a) return reject('tool_error');
    if (tool === 'search_threads') {
      const q = String(a.query ?? '');
      const after = Number(q.match(/after:(\d+)/)?.[1] ?? 0) * 1000;
      const before = Number(q.match(/before:(\d+)/)?.[1] ?? 9e12) * 1000;
      const hits = THREADS.filter((t) => t.messages.some((m) => {
        const at = Date.now() - m.hoursAgo * H;
        return at > after && at < before;
      }));
      return { payload: { threads: hits.map(threadOf), resultCountEstimate: String(hits.length) } };
    }
    if (tool === 'get_thread') {
      const t = THREADS.find((x) => x.id === a.threadId);
      return t ? { payload: threadOf(t) } : reject('tool_error');
    }
    return reject('not_in_manifest');
  },
};

/* ——— "Claude": answers from the fixture's hints ——— */

const hintFor = (id: string) => THREADS.find((t) => `g-${t.id}` === id || t.id === id)?.hint;

const sample = Object.assign(
  async (input: string) => ({ text: String(input).slice(0, 40), truncated: false }),
  {
    json: async (input: string, opts: { signal?: AbortSignal } = {}) => {
      await wait(Number(params().get('slow')) || 900);
      if (opts.signal?.aborted) return reject('cancelled');
      const f = fail('claude');
      if (f) return reject(f);
      const ids = [...String(input).matchAll(/<thread id="([^"]+)">/g)].map((m) => m[1]);
      const isDraft = String(input).includes('"proposal"');
      if (isDraft) {
        const h = hintFor(ids[0]);
        const notes = String(input).match(/Her notes, oldest first:\n([\s\S]*?)\n\nReply/);
        const base = h?.draft ?? { nextAction: 'Reply and close', summary: 'A short thread.', deliverable: null, proposal: 'Thank you — noted.\n\nBest,\nCarla', blockers: null, priority: 'Medium', dueAt: null, risk: null };
        return notes ? { ...base, proposal: `${String(base.proposal ?? '')}\n\n(revised per: ${notes[1].replace(/^- /gm, '').trim()})` } : base;
      }
      // triage: one object per thread asked, with a stray id the page must ignore
      return [...ids.map((id) => ({ id, ...(hintFor(id)?.triage ?? { category: 'Action required', actionRequired: true, priority: 'Medium', nextAction: 'Read this letter and decide', summary: '' }) })), { id: 'g-invented', category: 'Spam / Promotion' }];
    },
  },
);

/* ——— the store ——— */

type Listener = () => void;
const KEY = 'formulary.stubdb.v2';
let docs = new Map<string, Json>();
const leases = new Map<string, { holder: string; until: number }>();
const listeners = new Set<Listener>();

const persist = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...docs.entries()]));
  } catch {
    /* fine */
  }
};
const notify = () => setTimeout(() => listeners.forEach((l) => l()), 0);

const snapOf = (path: string) => {
  const data = docs.get(path);
  const id = path.split('/').pop()!;
  const frozen = data ? JSON.parse(JSON.stringify(data)) : undefined;
  return { id, exists: !!data, data: () => frozen, metadata: { fromCache: false, hasPendingWrites: false } };
};

const storeFail = () => {
  const f = fail('store');
  return f ? reject(f) : null;
};

const docRef = (path: string) => ({
  id: path.split('/').pop()!,
  path,
  get: async () => snapOf(path),
  set: async (data: Json) => {
    const f = storeFail();
    if (f) return f;
    if (params().get('write') === '0' && path.startsWith('lots/')) return reject('invalid_argument');
    docs.set(path, JSON.parse(JSON.stringify(data)));
    persist();
    notify();
  },
  update: async (data: Json) => {
    const f = storeFail();
    if (f) return f;
    if (params().get('write') === '0' && path.startsWith('lots/')) return reject('invalid_argument');
    const cur = docs.get(path);
    if (!cur) return reject('invalid_argument');
    docs.set(path, { ...cur, ...JSON.parse(JSON.stringify(data)) });
    persist();
    notify();
  },
  delete: async () => {
    docs.delete(path);
    persist();
    notify();
  },
  acquire: async ({ holder, ttlMs = 30000 }: { holder: string; ttlMs?: number }) => {
    const now = Date.now();
    const l = leases.get(path);
    const ttl = Math.min(600000, Math.max(1000, ttlMs));
    if (l && l.until > now && l.holder !== holder) return { acquired: false, expiresAt: new Date(l.until).toISOString() };
    leases.set(path, { holder, until: now + ttl });
    return { acquired: true, holder, version: 1, expiresAt: new Date(now + ttl).toISOString() };
  },
  onSnapshot: (next: (s: ReturnType<typeof snapOf>) => void) => {
    const l = () => next(snapOf(path));
    listeners.add(l);
    setTimeout(l, 0);
    return () => listeners.delete(l);
  },
  collection: (sub: string) => query(`${path}/${sub}`, [], null, 1000),
});

type Where = [string, string, unknown];
const query = (coll: string, wheres: Where[], order: [string, 'asc' | 'desc'] | null, lim: number): unknown => {
  const run = () => {
    let rows = [...docs.entries()].filter(([p]) => p.startsWith(`${coll}/`) && p.split('/').length === coll.split('/').length + 1);
    for (const [field, op, value] of wheres) {
      rows = rows.filter(([, d]) => (op === '==' ? d[field] === value : op === '!=' ? d[field] !== value : true));
    }
    if (order) {
      const [field, dir] = order;
      rows.sort(([, a], [, b]) => {
        const x = a[field] as string | number | undefined;
        const y = b[field] as string | number | undefined;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
      });
    }
    const out = rows.slice(0, lim).map(([p]) => snapOf(p));
    return { docs: out, size: out.length, empty: out.length === 0, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] };
  };
  return {
    path: coll,
    where: (f: string, op: string, v: unknown) => query(coll, [...wheres, [f, op, v]], order, lim),
    orderBy: (f: string, dir: 'asc' | 'desc' = 'asc') => query(coll, wheres, [f, dir], lim),
    limit: (n: number) => query(coll, wheres, order, n),
    get: async () => run(),
    onSnapshot: (next: (s: ReturnType<typeof run>) => void) => {
      const l = () => next(run());
      listeners.add(l);
      setTimeout(l, 0);
      return () => listeners.delete(l);
    },
    doc: (id?: string) => docRef(`${coll}/${id ?? Math.random().toString(36).slice(2, 12)}`),
    add: async (data: Json) => {
      const ref = docRef(`${coll}/${Math.random().toString(36).slice(2, 12)}`);
      await ref.set(data);
      return ref;
    },
  };
};

const db = { doc: docRef, collection: (p: string) => query(p, [], null, 1000) };

const user = {
  isOwner: async () => params().get('owner') !== '0',
  canEdit: async () => params().get('owner') !== '0',
  can: async (name: string) => (name === 'data.write' ? params().get('write') !== '0' : false),
  id: async () => 'u_stub',
};

export function installInboxStub() {
  try {
    if (params().get('reset') === '1') localStorage.removeItem(KEY);
    docs = new Map(JSON.parse(localStorage.getItem(KEY) || '[]') as [string, Json][]);
  } catch {
    docs = new Map();
  }
  // the studio notes Claude would seed into the store
  if (!docs.has('meta/robot')) {
    docs.set('meta/robot', {
      mailbox: params().get('nomailbox') === '1' ? '' : BOX,
      notes: 'Prepare, never send. Carla reviews; Barbara carries out approved actions by hand.',
      roster: ['Eugenia Galdo <meg@example.test>'],
      projects: ['Forte 1801', 'Acqualina'],
      signature: 'Carla',
    });
  }
  (window as unknown as { __stub: unknown }).__stub = { docs: () => docs, leases, threads: THREADS };
  const delay = Number(params().get('connect')) || 0;
  window.claude = {
    use: async (name: string) => {
      if (delay > 0) await wait(delay);
      if (name === 'db') return db;
      if (name === 'mcp') return mcp;
      if (name === 'sample') return sample;
      if (name === 'user') return user;
      return null;
    },
  };
}
