import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { Tab, Task } from '../types';
import {
  BARS,
  initialState,
  reducer,
  resolveDue,
  type Action,
  type Draft,
  type Robot,
  type SlipDraft,
  type State,
} from './model';
import { stamp, tallyNumber } from '../lib/format';
import { inArtifact, useDb, useMcp, useSample, useUser, type Db, type Mcp, type Sample } from '../lib/runtime';
import { describe, setVoice, type Failure } from '../lib/failure';
import { supabaseDb } from '../lib/sbdb';
import {
  askToJoin,
  call,
  checkJoin,
  cloudConfigured,
  connectGmail,
  currentWho,
  decideJoin,
  forgetAsk,
  keepStorage,
  savedAsk,
  sb,
  watchJoinRequests,
  type CallError,
  type PairAsk,
  type RobotStatus,
  type Who,
} from '../lib/cloud';
import { COMPOSE_CONTEXTS, flagsOf, isCurated, readLot, toTask, type LotDoc } from '../lib/inbox';
import {
  DEFAULT_CONFIG,
  claimLots,
  clean,
  configDoc,
  countDraft,
  draft,
  draftsToday,
  hold,
  read,
  sweep,
  readConfig,
  readSync,
  serial,
  syncDoc,
  tidy,
  urgentUndrafted,
  type Progress,
  type RobotConfig,
  type SyncMeta,
} from '../lib/robot';

import { isBarbaraPending, reviewPatch } from '../lib/review';

const KEY = 'formulary.v1';
const PREFS = 'formulary.prefs.v1';

/**
 * Local persistence stands in for the server on the seed. The seed is dated relative
 * to the day it was laid down, so when the day rolls over we start a fresh reference
 * set rather than letting "today" quietly mean yesterday. In the inbox only the
 * viewer's own conveniences (tab, show-all) stay in the browser; lots live in the store.
 */
function load(): State {
  const fresh = initialState();
  try {
    if (inArtifact() || cloudConfigured()) {
      const prefs = JSON.parse(localStorage.getItem(PREFS) || '{}') as Partial<State>;
      return {
        ...fresh,
        // boot straight into the inbox: not one frame of seed lots before the store answers
        mode: 'inbox',
        sync: 'loading',
        tasks: [],
        tab: prefs.tab ?? 'today',
        showAll: !!prefs.showAll,
      };
    }
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as State;
    if (saved.seededOn !== stamp(new Date())) return fresh;
    return {
      ...fresh,
      tasks: saved.tasks,
      acted: saved.acted ?? {},
      events: saved.events ?? [],
      tab: saved.tab ?? 'today',
    };
  } catch {
    return fresh;
  }
}

function save(state: State) {
  try {
    if (state.mode === 'inbox') {
      localStorage.setItem(PREFS, JSON.stringify({ tab: state.tab, showAll: state.showAll }));
      return;
    }
    const { tasks, acted, events, tab, seededOn } = state;
    localStorage.setItem(KEY, JSON.stringify({ tasks, acted, events, tab, seededOn }));
  } catch {
    /* private mode, quota — the app still works, it just forgets */
  }
}

const byLotAsc = (a: Task, b: Task) => a.lot - b.lot;
const byLotDesc = (a: Task, b: Task) => b.lot - a.lot;

export type ListView = {
  hero: Task | null;
  rows: Task[];
  tally: string;
  kicker: string;
  count: string;
};

export function buildListView(tasks: Task[], tab: Tab): ListView {
  if (tab === 'archive') {
    const filed = tasks.filter((t) => t.done).sort(byLotDesc);
    return {
      hero: null,
      rows: filed,
      tally: `${tallyNumber(filed.length)} filed`,
      kicker: 'filed',
      count: tallyNumber(filed.length),
    };
  }

  const bucket = tab === 'today' ? 'today' : 'upcoming';
  const inTab = tasks.filter((t) => t.bucket === bucket).sort(byLotAsc);
  const open = inTab.filter((t) => !t.done);
  const doneCount = inTab.length - open.length;
  const hero = open.find((task) => !task.prepared || !['barbara', 'changes'].includes(task.prepared.review)) ?? null;
  const rows = inTab.filter((t) => t.id !== hero?.id);

  return {
    hero,
    rows,
    tally: `${tallyNumber(open.length)} open` + (doneCount > 0 ? ` · ${tallyNumber(doneCount)} done` : ''),
    kicker: 'then',
    count: tallyNumber(rows.length),
  };
}

/** One id per open view: the robot's lease is held by a view, not a person. */
const holderId = () => `view-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

const nowIso = () => new Date().toISOString();
/** What Google's return trip (gmail-auth → app#gmail=…) means, in the app's voice. */
const GMAIL_BACK: Record<string, string> = {
  connected: 'gmail connected · read only',
  denied: 'google access wasn’t allowed',
  expired: 'that connect link expired · try again',
  'wrong-account': 'that was another google account · use the studio mailbox',
  'too-much': 'more than read access was granted · connect again, read only',
  'no-refresh': 'google gave no lasting access · remove formulary in google, then connect again',
};

const OPEN_LIMIT = 1000;
const ARCHIVE_LIMIT = 200;

type Lot = { id: string; doc: LotDoc };

export function useFormulary() {
  const [state, rawDispatch] = useReducer((s: State, a: Action) => reducer(s, a), undefined, load);
  const dispatch = rawDispatch as (a: Action) => void;

  const db = useRef<Db | null>(null);
  const mcp = useRef<Mcp | null>(null);
  const sample = useRef<Sample | null>(null);
  const owner = useRef(false);
  const openLots = useRef<Lot[]>([]);
  const closedLots = useRef<Lot[]>([]);
  const reviewLots = useRef<Record<string, Lot[]>>({});
  const detailLot = useRef<Lot | null>(null);
  const viewer = useRef<Who | null>(null);
  const refreshQueue = useRef<(() => Promise<void>) | null>(null);
  const writing = useRef(new Set<string>());
  const archiveCapped = useRef(false);
  const config = useRef<RobotConfig>(DEFAULT_CONFIG);
  const syncMeta = useRef<SyncMeta>(readSync(undefined));
  const holder = useRef(holderId());
  const runCtl = useRef<AbortController | null>(null);
  const onCtl = useRef<AbortController | null>(null);
  const firstSnapshot = useRef<Promise<void> | null>(null);
  const showAllRef = useRef(state.showAll);
  showAllRef.current = state.showAll;
  const screenRef = useRef(state.screen);
  screenRef.current = state.screen;
  const selectedRef = useRef(state.selectedId);
  selectedRef.current = state.selectedId;
  const pendingRef = useRef(state.pending);
  pendingRef.current = state.pending;
  const robotRef = useRef(state.robot);
  robotRef.current = state.robot;
  /** The cloud build: lots in Supabase, the robot on the server. */
  const cloud = useRef(false);

  useEffect(() => {
    save(state);
  }, [state.mode, state.tasks, state.acted, state.events, state.tab, state.showAll]);

  /* ——— toast ——— */

  const toastTimer = useRef<number | null>(null);
  const toast = useCallback((text: string, ms = 2600) => {
    dispatch({ type: 'toast', text });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => dispatch({ type: 'toast', text: null }), ms);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const robot = useCallback((patch: Partial<Robot>) => dispatch({ type: 'robot', patch }), []);

  /* ——— the store, live ——— */

  const allLots = () => {
    const seen = new Set<string>();
    const out: Lot[] = [];
    const detail = detailLot.current?.id === selectedRef.current ? [detailLot.current] : [];
    for (const l of (viewer.current === 'barbara' ? [...detail, ...Object.values(reviewLots.current).flat()] : [...openLots.current, ...closedLots.current])) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      out.push(l);
    }
    return out;
  };

  const render = useCallback(() => {
    const now = new Date();
    // unread stubs wait for the robot; everything else shows by the work filter — and her open lot always stays
    const keep = (l: Lot) =>
      viewer.current === 'barbara' ? l.id === selectedRef.current || isBarbaraPending(toTask(l.id, l.doc, now)) : l.id === selectedRef.current || !!pendingRef.current[l.id] || (l.doc.read && (showAllRef.current || isCurated(l.doc)));
    dispatch({
      type: 'loaded',
      tasks: allLots().filter(keep).map(({ id, doc }) => toTask(id, doc, now)),
      archiveCapped: archiveCapped.current,
    });
    const fresh = openLots.current.filter((l) => !l.doc.read).length;
    if (fresh !== robotRef.current.fresh) dispatch({ type: 'robot', patch: { fresh } });
  }, []);

  // Keep an open handoff visible even if another device moves it out of the
  // queue. The editor can then show the conflict without discarding typed work.
  useEffect(() => {
    detailLot.current = null;
    const store = db.current;
    const id = state.selectedId;
    if (state.who !== 'barbara' || !id || !store) return;
    return store.doc(`lots/${id}`).onSnapshot((snap) => {
      const doc = snap.exists ? readLot(snap.data()) : null;
      if (selectedRef.current !== id) return;
      detailLot.current = doc ? { id, doc } : null;
      render();
    }, () => toast('couldn’t refresh this handoff · your text is kept', 5200));
  }, [state.who, state.selectedId, render, toast]);

  const maxLot = () => allLots().reduce((m, l) => Math.max(m, l.doc.lot ?? 0), 0);

  /** Sweep new mail into unread stubs — Gmail and the store only, no Claude. */
  const count = useCallback(async () => {
    if (cloud.current) {
      if (runCtl.current || onCtl.current) return;
      robot({ phase: 'listing' });
      let failure: Failure | null = null;
      let skipped = robotRef.current.skipped;
      try {
        const r = await call<{ busy?: boolean; failure?: Failure; wrongMailbox?: string; olderSkipped?: boolean }>('robot', { action: 'sweep' });
        if (r.failure) failure = r.failure;
        else if (r.wrongMailbox) failure = wrongMailbox(r.wrongMailbox, config.current.mailbox);
        skipped = !!r.olderSkipped;
      } catch (e) {
        failure = cloudFailure(e);
      }
      robot({ phase: 'idle', failure, skipped });
      return;
    }
    const ns = mcp.current;
    const store = db.current;
    if (!ns || !store || !owner.current || runCtl.current || onCtl.current) return;
    await firstSnapshot.current;
    const held = await hold(store, holder.current);
    if (!held) return; // another view is sweeping or reading; its stubs arrive by snapshot
    robot({ phase: 'listing' });
    let failure: Failure | null = null;
    let skipped = robotRef.current.skipped;
    try {
      const r = await sweep({ db: store, mcp: ns, config: config.current, holder: holder.current, sync: syncMeta.current, maxLot, signal: held.signal });
      if (r.wrongMailbox) failure = wrongMailbox(r.wrongMailbox, config.current.mailbox);
      skipped = r.olderSkipped;
    } catch (e) {
      failure = describe(e, (e as { code?: string })?.code && ['invalid_argument', 'resource_exhausted', 'quota_exceeded', 'unavailable', 'revoked'].includes((e as { code: string }).code) ? 'store' : 'gmail');
      if (failure.source === 'gmail' && failure.terminal) mcp.current = null;
    } finally {
      await held.release().catch(() => undefined);
    }
    robot({ phase: 'idle', failure, skipped, able: !!mcp.current && !!sample.current && owner.current });
  }, [robot]);

  /** Live views of the store: open lots, filed lots, the robot's notes and cursor. Shared by both builds. */
  const subscribe = useCallback(
    (store: Db, unsubs: (() => void)[], isAlive: () => boolean) => {
      if (viewer.current === 'barbara') {
        // Query each actionable status independently. Approved lots are closed to
        // Carla, but must never depend on the 200-item archive window here.
        const reviews = ['approved', 'barbara', 'changes'] as const;
        const queries = reviews.map((review) => store.collection('lots')
          .where('completed', '==', false).where('review', '==', review)
          .orderBy('receivedAt', 'desc').limit(OPEN_LIMIT));
        const ready = new Set<string>();
        const failures = new Map<string, Failure>();
        const accept = (review: string, snap: Awaited<ReturnType<typeof queries[number]['get']>>) => {
          if (!isAlive()) return;
          reviewLots.current[review] = snap.docs.map((d) => ({ id: d.id, doc: readLot(d.data()) }))
            .filter((l): l is Lot => !!l.doc);
          ready.add(review);
          failures.delete(review);
          archiveCapped.current = Object.values(reviewLots.current).some((lots) => lots.length >= OPEN_LIMIT);
          if (ready.size === reviews.length) {
            render();
            const failure = failures.values().next().value;
            if (failure) dispatch({ type: 'loadFailed', failure });
          }
        };
        const fail = (review: string, error: unknown) => {
          if (!isAlive()) return;
          const failure = describe(error, 'store');
          ready.add(review);
          failures.set(review, failure);
          dispatch(failure.terminal ? { type: 'offline', failure } : { type: 'loadFailed', failure });
        };
        reviews.forEach((review, i) => unsubs.push(queries[i].onSnapshot((snap) => accept(review, snap), (e) => fail(review, e))));
        refreshQueue.current = async () => {
          await Promise.all(reviews.map(async (review, i) => {
            try { accept(review, await queries[i].get()); }
            catch (e) { fail(review, e); }
          }));
        };
        unsubs.push(() => { refreshQueue.current = null; reviewLots.current = {}; });
        return;
      }
      let got = { open: false, closed: false };
      let resolveFirst: () => void = () => undefined;
      firstSnapshot.current = new Promise<void>((r) => (resolveFirst = r));
      const settle = () => {
        render();
        if (got.open && got.closed) resolveFirst();
      };
      const onError = (which: 'open' | 'closed', again: () => void) => (e: { code: string; message: string }) => {
        const f = describe(e, 'store');
        got = { ...got, [which]: true };
        if (f.code === 'unavailable' && isAlive()) {
          // the bridge stopped answering: one fresh subscription is the only recovery
          window.setTimeout(() => isAlive() && again(), 1500 + Math.random() * 1000);
          return;
        }
        dispatch(f.terminal ? { type: 'offline', failure: f } : { type: 'loadFailed', failure: f });
        resolveFirst();
      };
      const lotsOf = (docs: { id: string; data(): Record<string, unknown> | undefined }[]) =>
        docs.map((d) => ({ id: d.id, doc: readLot(d.data()) })).filter((x): x is Lot => !!x.doc);

      const subOpen = () =>
        unsubs.push(
          store
            .collection('lots')
            .where('open', '==', true)
            .orderBy('receivedAt', 'desc')
            .limit(OPEN_LIMIT)
            .onSnapshot((snap) => {
              openLots.current = lotsOf(snap.docs);
              got = { ...got, open: true };
              settle();
            }, onError('open', subOpen)),
        );
      const subClosed = () =>
        unsubs.push(
          store
            .collection('lots')
            .where('open', '==', false)
            .orderBy('closedAt', 'desc')
            .limit(ARCHIVE_LIMIT)
            .onSnapshot((snap) => {
              closedLots.current = lotsOf(snap.docs);
              archiveCapped.current = snap.size >= ARCHIVE_LIMIT;
              got = { ...got, closed: true };
              settle();
            }, onError('closed', subClosed)),
        );
      subOpen();
      subClosed();
      unsubs.push(configDoc(store).onSnapshot((snap) => (config.current = readConfig(snap.exists ? snap.data() : undefined)), () => undefined));
      unsubs.push(syncDoc(store).onSnapshot((snap) => (syncMeta.current = readSync(snap.exists ? snap.data() : undefined)), () => undefined));
    },
    [render],
  );

  /* ——— the artifact build: claude.ai's store, connectors and Claude ——— */

  useEffect(() => {
    if (!inArtifact()) return;
    let alive = true;
    const unsubs: (() => void)[] = [];
    dispatch({ type: 'boot', mode: 'inbox' });

    (async () => {
      const [store, connector, claude, user] = await Promise.all([useDb(), useMcp(), useSample(), useUser()]);
      if (!alive) return;
      if (!store) {
        dispatch({ type: 'offline' });
        return;
      }
      db.current = store;
      mcp.current = connector;
      sample.current = claude;
      subscribe(store, unsubs, () => alive);

      // who may do what. The robot reads the mailbox of whoever runs it, so only the owner's view may run it.
      const [canWrite, isOwner] = user ? await Promise.all([user.can('data.write'), user.isOwner()]) : [null, false];
      if (!alive) return;
      owner.current = isOwner;
      dispatch({ type: 'connected', canWrite });
      // the owner is told what the robot is missing; everyone else just works the lots
      const missing = !isOwner ? null : !connector ? describe({ code: 'server_not_connected' }, 'gmail') : !claude ? describe({ code: 'capability_disabled' }, 'claude') : null;
      robot({ able: !!connector && !!claude && isOwner, failure: missing });
      if (connector && isOwner) {
        // the config arrives by snapshot; give it a moment before the first count
        await configDoc(store).get().then((snap) => (config.current = readConfig(snap.exists ? snap.data() : undefined))).catch(() => undefined);
        await syncDoc(store).get().then((snap) => (syncMeta.current = readSync(snap.exists ? snap.data() : undefined))).catch(() => undefined);
        if (alive) void count();
      }
    })();

    return () => {
      alive = false;
      unsubs.forEach((u) => u());
      runCtl.current?.abort();
      onCtl.current?.abort();
    };
  }, [render, count, robot, subscribe]);

  /* ——— the cloud build: its own address, Supabase behind it, a device joined once ——— */

  /** What the server says the robot is missing, in her words; null when it can run. */
  const statusFailure = (st: RobotStatus): Failure | null => {
    if (!st.google) return { ...describe({ code: 'server_not_connected' }, 'gmail'), text: 'google isn’t set up yet · add the client id and secret in supabase' };
    if (!st.gmail.connected) return describe({ code: 'server_not_connected' }, 'gmail');
    if (!st.claude) return describe({ code: 'sampling_disabled' }, 'claude');
    return null;
  };

  /** A failed call to the server, in the app's own terms. A dead session sends the device back to pairing. */
  const cloudFailure = (e: unknown): Failure | null => {
    const x = (e ?? {}) as CallError;
    if (x.code === 'cancelled') return null;
    if (x.code === 'revoked') {
      void sb().auth.signOut({ scope: 'local' });
      dispatch({ type: 'pair', pair: { phase: 'who', note: 'this device was signed out · join again' } });
      return null;
    }
    return describe({ code: x.code || 'unavailable', message: x.message }, 'store');
  };

  const cloudStatus = useCallback(async () => {
    try {
      const st = await call<RobotStatus>('robot', { action: 'status' });
      const failure = statusFailure(st);
      robot({ able: !failure, failure });
      return !failure || failure.source === 'claude' ? st : null;
    } catch (e) {
      robot({ able: false, failure: cloudFailure(e) });
      return null;
    }
  }, [robot]);

  const startCloud = useCallback(
    async (who: Who, unsubs: (() => void)[], isAlive: () => boolean) => {
      unsubs.splice(0).forEach((off) => off());
      openLots.current = [];
      closedLots.current = [];
      reviewLots.current = {};
      detailLot.current = null;
      archiveCapped.current = false;
      dispatch({ type: 'boot', mode: 'inbox' });
      dispatch({ type: 'pair', pair: null });
      viewer.current = who;
      dispatch({ type: 'backend', backend: 'cloud', who });
      const store = supabaseDb(sb());
      db.current = store;
      owner.current = true;
      subscribe(store, unsubs, isAlive);
      dispatch({ type: 'connected', canWrite: true });
      unsubs.push(watchJoinRequests((joins) => isAlive() && dispatch({ type: 'joins', joins })));
      if (who === 'barbara') return; // reviewing the queue never starts mailbox processing
      // back from Google's consent page
      const back = location.hash.match(/gmail=([a-z_-]+)/);
      if (back) {
        history.replaceState(null, '', location.pathname + location.search);
        toast(GMAIL_BACK[back[1]] ?? 'gmail wasn’t connected · try again', 5200);
      }
      const st = await cloudStatus();
      if (isAlive() && st?.gmail.connected) void count();
    },
    [subscribe, cloudStatus, toast],
  );

  const pollJoin = useRef<number | null>(null);
  const waitForYes = useCallback(
    (ask: PairAsk, unsubs: (() => void)[], isAlive: () => boolean) => {
      dispatch({ type: 'pair', pair: { phase: 'waiting', who: ask.who, words: ask.words } });
      const tick = async () => {
        if (!isAlive()) return;
        try {
          const st = await checkJoin(ask);
          if (!isAlive()) return;
          if (st === 'issued') {
            if (pollJoin.current) window.clearInterval(pollJoin.current);
            pollJoin.current = null;
            const who = await currentWho();
            if (who) void startCloud(who, unsubs, isAlive);
            else dispatch({ type: 'pair', pair: { phase: 'error', note: 'joined, but this device is not one of the two · ask barbara' } });
          } else if (st === 'denied' || st === 'expired' || st === 'unknown') {
            if (pollJoin.current) window.clearInterval(pollJoin.current);
            pollJoin.current = null;
            dispatch({ type: 'pair', pair: { phase: st === 'denied' ? 'denied' : 'expired' } });
          }
        } catch {
          /* no connection: the next tick asks again */
        }
      };
      if (pollJoin.current) window.clearInterval(pollJoin.current);
      pollJoin.current = window.setInterval(tick, 2500);
      void tick();
    },
    [startCloud],
  );

  const cloudUnsubs = useRef<(() => void)[]>([]);
  const cloudAlive = useRef(false);

  useEffect(() => {
    if (!cloudConfigured() || /^#(inbox|seed)/.test(location.hash)) return;
    cloud.current = true;
    cloudAlive.current = true;
    const unsubs: (() => void)[] = [];
    cloudUnsubs.current = unsubs;
    const isAlive = () => cloudAlive.current;
    setVoice('cloud');
    keepStorage();
    dispatch({ type: 'boot', mode: 'inbox' });
    dispatch({ type: 'backend', backend: 'cloud' });

    (async () => {
      const who = await currentWho().catch(() => null);
      if (!isAlive()) return;
      if (who) return startCloud(who, unsubs, isAlive);
      const ask = savedAsk();
      if (ask) waitForYes(ask, unsubs, isAlive);
      else dispatch({ type: 'pair', pair: { phase: 'who' } });
    })();

    return () => {
      cloudAlive.current = false;
      if (pollJoin.current) window.clearInterval(pollJoin.current);
      pollJoin.current = null;
      unsubs.forEach((u) => u());
      runCtl.current?.abort();
      onCtl.current?.abort();
    };
  }, [startCloud, waitForYes]);


  // come back to the tab after a while and the count refreshes itself (Gmail only, no Claude)
  const hiddenAt = useRef(0);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if ((mcp.current || (cloud.current && robotRef.current.able)) && hiddenAt.current && Date.now() - hiddenAt.current > 3 * 60 * 1000) void count();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [count]);

  /* ——— the robot, on her gesture ——— */

  const progress = useCallback(
    (p: Progress) => robot('done' in p ? { phase: p.phase, done: p.done, total: p.total } : { phase: p.phase, done: 0, total: 0 }),
    [robot],
  );

  const afterClaude = (f: Failure | null) => {
    if (f?.source === 'claude' && f.terminal) sample.current = null;
    if (f?.source === 'gmail' && f.terminal) mcp.current = null;
  };

  /** Read new mail, tidy, answer her notes, draft the most urgent. One tap; a second tap stops it. */
  const readMail = useCallback(async () => {
    if (runCtl.current) {
      runCtl.current.abort();
      return;
    }
    if (cloud.current) {
      if (onCtl.current) return;
      const ctl = new AbortController();
      runCtl.current = ctl;
      robot({ phase: 'listing', failure: null, elsewhere: false, run: true });
      let failure: Failure | null = null;
      type Step = { busy?: boolean; failure?: Failure | null; wrongMailbox?: string; olderSkipped?: boolean; read?: number; left?: number };
      const step = (action: string) => call<Step>('robot', { action }, ctl.signal);
      try {
        const swept = await step('sweep');
        if (swept.busy) {
          robot({ elsewhere: true });
          return;
        }
        if (swept.failure || swept.wrongMailbox) {
          failure = swept.failure ?? wrongMailbox(swept.wrongMailbox ?? '', config.current.mailbox);
          return;
        }
        robot({ skipped: !!swept.olderSkipped });
        // read in rounds the server can finish; the count shows what is left
        let done = 0;
        for (let round = 0; round < 6 && !ctl.signal.aborted; round++) {
          const r = await step('read');
          if (r.busy) {
            robot({ elsewhere: true });
            return;
          }
          done += r.read ?? 0;
          progress({ phase: 'reading', done, total: done + (r.left ?? 0) });
          if (r.failure) {
            failure = r.failure;
            return;
          }
          if (!r.left || !r.read) break;
        }
        if (ctl.signal.aborted) return;
        progress({ phase: 'tidying' });
        await step('tidy').catch(() => undefined);
        robot({ phase: 'revising' });
        const rev = await step('revisions');
        if (rev.failure) {
          failure = rev.failure;
          return;
        }
        progress({ phase: 'drafting', done: 0, total: config.current.autoDraft });
        const urg = await step('urgent');
        if (urg.failure) failure = urg.failure;
      } catch (e) {
        failure = cloudFailure(e);
      } finally {
        runCtl.current = null;
        robot({ phase: 'idle', done: 0, total: 0, on: null, run: false, failure });
      }
      return;
    }
    const store = db.current;
    const ns = mcp.current;
    const claude = sample.current;
    if (!store || !ns || !claude || !owner.current || onCtl.current) return;
    const sync = syncMeta.current;
    if (sync.backoffUntil && sync.backoffUntil > Date.now()) {
      robot({ failure: describe({ code: 'rate_limited' }, 'claude') });
      return;
    }
    const ctl = new AbortController();
    runCtl.current = ctl;
    robot({ phase: 'listing', failure: null, elsewhere: false, run: true });
    let failure: Failure | null = null;
    const held = await hold(store, holder.current, ctl.signal);
    if (!held) {
      runCtl.current = null;
      robot({ phase: 'idle', elsewhere: true, run: false });
      return;
    }
    try {
      await firstSnapshot.current;
      try {
        const r = await sweep({ db: store, mcp: ns, config: config.current, holder: holder.current, sync, maxLot, signal: held.signal });
        robot({ skipped: r.olderSkipped });
        if (r.wrongMailbox) {
          failure = wrongMailbox(r.wrongMailbox, config.current.mailbox);
          return;
        }
      } catch (e) {
        failure = describe(e, 'gmail');
        return;
      }
      if (held.signal.aborted) return;
      // the stubs to read come from the store itself, not from what this view happens to hold
      const unreadSnap = await store.collection('lots').where('read', '==', false).limit(400).get();
      const unread = unreadSnap.docs
        .map((d) => ({ id: d.id, doc: readLot(d.data()) }))
        .filter((x): x is Lot => !!x.doc && x.doc.kind === 'mail');
      const outcome = await read({ db: store, sample: claude, config: config.current, signal: held.signal, onProgress: progress }, unread);
      if (outcome.failure || held.signal.aborted) {
        failure = outcome.failure;
        return;
      }

      // what is open now, read from the store — this view's snapshot may not have caught up with the robot's writes
      const lotsIn = (docs: { id: string; data(): Record<string, unknown> | undefined }[]) =>
        docs.map((d) => ({ id: d.id, doc: readLot(d.data()) })).filter((x): x is Lot => !!x.doc);
      const openNow = lotsIn((await store.collection('lots').where('open', '==', true).limit(OPEN_LIMIT).get()).docs);

      progress({ phase: 'tidying' });
      await tidy(store, openNow).catch(() => 0);

      // her notes first: lots she sent back to the robot that are still waiting
      const waiting = await store.collection('lots').where('review', '==', 'changes').limit(20).get();
      for (const { id, doc } of waiting.docs.map((d) => ({ id: d.id, doc: readLot(d.data()) })).filter((x): x is Lot => !!x.doc && !x.doc.robot)) {
        if (held.signal.aborted) return;
        robot({ phase: 'revising', on: id });
        const notes = (doc.slips ?? []).filter((x) => x.to === 'the robot').map((x) => x.note).slice(-3);
        const f = await draft({ db: store, mcp: ns, sample: claude, config: config.current, signal: held.signal }, id, {
          notes: notes.length ? notes : [doc.feedback ?? ''],
        });
        if (f) {
          failure = f;
          return;
        }
      }

      // then the most urgent drafts, within the day's allowance
      const room = Math.max(0, config.current.dailyDrafts - draftsToday(syncMeta.current));
      const next = urgentUndrafted(openNow, new Date(), Math.min(config.current.autoDraft, room));
      for (let i = 0; i < next.length; i++) {
        if (held.signal.aborted) return;
        progress({ phase: 'drafting', done: i, total: next.length });
        robot({ on: next[i].id });
        const f = await draft({ db: store, mcp: ns, sample: claude, config: config.current, signal: held.signal }, next[i].id);
        if (f) {
          failure = f;
          return;
        }
        await countDraft(store, syncMeta.current);
      }
    } finally {
      await held.release().catch(() => undefined);
      if (held.lost()) robot({ elsewhere: true });
      afterClaude(failure);
      runCtl.current = null;
      robot({ phase: 'idle', done: 0, total: 0, on: null, run: false, failure, able: !!mcp.current && !!sample.current && owner.current });
    }
  }, [progress, robot]);

  /** One lot, on her gesture: "prepare the reply", or a slip handed to the robot. */
  const draftOne = useCallback(
    async (id: string, revision?: { notes: string[] }) => {
      if (cloud.current) {
        if (runCtl.current || onCtl.current) {
          toast('the robot is busy · your lot is next when it finishes', 4000);
          return;
        }
        const ctl = new AbortController();
        onCtl.current = ctl;
        robot({ phase: revision ? 'revising' : 'drafting', on: id, failure: null, done: 0, total: 0 });
        let f: Failure | null = null;
        try {
          const r = await call<{ busy?: boolean; failure?: Failure | null }>(
            'robot',
            revision ? { action: 'revise', id, notes: revision.notes } : { action: 'draft', id },
            ctl.signal,
          );
          if (r.busy) toast(revision ? 'the robot is busy with this lot · your note is kept' : 'the robot is already on this lot', 4000);
          f = r.failure ?? null;
        } catch (e) {
          f = cloudFailure(e);
        } finally {
          onCtl.current = null;
          robot({ phase: 'idle', on: null });
        }
        if (f) toast(revision ? `${f.text} · your note is kept` : f.text, 5200);
        return;
      }
      const store = db.current;
      const ns = mcp.current;
      const claude = sample.current;
      if (!store || !ns || !claude || !owner.current) return;
      if (runCtl.current || onCtl.current) {
        toast('the robot is busy · your lot is next when it finishes', 4000);
        return;
      }
      const ctl = new AbortController();
      onCtl.current = ctl;
      robot({ phase: revision ? 'revising' : 'drafting', on: id, failure: null, done: 0, total: 0 });
      const held = await hold(store, holder.current, ctl.signal);
      if (!held) {
        onCtl.current = null;
        robot({ phase: 'idle', on: null, elsewhere: true });
        toast(revision ? 'the robot is busy on another device · your note is kept' : 'the robot is busy on another device', 4000);
        return;
      }
      let f: Failure | null = null;
      try {
        f = await draft({ db: store, mcp: ns, sample: claude, config: config.current, signal: held.signal }, id, revision);
        if (!f && !revision) await countDraft(store, syncMeta.current);
      } finally {
        await held.release().catch(() => undefined);
        afterClaude(f);
        onCtl.current = null;
        robot({ phase: 'idle', on: null, able: !!mcp.current && !!sample.current && owner.current });
      }
      if (f) toast(revision ? `${f.text} · your note is kept` : f.text, 5200);
    },
    [robot, toast],
  );

  /** Stop what the robot is doing for her on this lot (leaving the label, or the stop control). */
  const stopOne = useCallback(() => onCtl.current?.abort(), []);

  /* ——— writes to a lot: hers, serialised with the robot's in this page ——— */

  const write = useCallback(
    async (task: Task, change: (doc: LotDoc) => Record<string, unknown>, okText: string) => {
      const store = db.current;
      if (!store) {
        toast('the lot store isn’t available here', 4000);
        return false;
      }
      if (writing.current.has(task.id)) return false;
      writing.current.add(task.id);
      dispatch({ type: 'pending', id: task.id, on: true });
      const attempt = () =>
        serial(task.id, async () => {
          const ref = store.doc(`lots/${task.id}`);
          const snap = await ref.get();
          const doc = snap.exists ? readLot(snap.data()) : null;
          if (!doc) throw { code: 'gone', message: 'this lot is no longer in the store' };
          if (task.prepared?.updatedAt && task.prepared.updatedAt !== doc.updatedAt) {
            throw { code: 'review_conflict', message: 'this lot changed on another device · refresh and review it again' };
          }
          const patch = change(doc);
          const merged = { ...doc, ...patch } as LotDoc;
          const flags = flagsOf(merged);
          const closing = doc.open && !flags.open;
          const opening = !doc.open && flags.open;
          const saved = { ...merged, ...flags, ...(closing ? { closedAt: nowIso() } : {}), ...(opening ? { closedAt: null } : {}), updatedAt: nowIso() };
          await ref.update(clean({ ...patch, ...flags, closedAt: saved.closedAt ?? null, updatedAt: saved.updatedAt }));
          // Change the local lists only after the shared save succeeds. Realtime
          // supplies subsequent changes made by Carla, Barbara, or the robot.
          const updated = { id: task.id, doc: saved };
          if (viewer.current === 'barbara') {
            if (detailLot.current?.id === task.id) detailLot.current = updated;
            for (const key of Object.keys(reviewLots.current)) reviewLots.current[key] = reviewLots.current[key].filter((l) => l.id !== task.id);
            if (!saved.completed && ['approved', 'barbara', 'changes'].includes(saved.review)) {
              reviewLots.current[saved.review] = [...(reviewLots.current[saved.review] ?? []), updated];
            }
          } else {
            openLots.current = openLots.current.filter((l) => l.id !== task.id);
            closedLots.current = closedLots.current.filter((l) => l.id !== task.id);
            (saved.open ? openLots : closedLots).current.push(updated);
          }
        });
      try {
        try {
          await attempt();
        } catch (e) {
          // a transient store hiccup gets one quiet retry; a refusal does not
          if ((e as { code?: string })?.code !== 'unavailable') throw e;
          await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
          await attempt();
        }
        toast(okText);
        return true;
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code?.startsWith('review_')) {
          toast((e as Error).message, 5200);
          if (viewer.current === 'barbara') {
            const snap = await store.doc(`lots/${task.id}`).get().catch(() => null);
            const latest = snap?.exists ? readLot(snap.data()) : null;
            if (latest && selectedRef.current === task.id) detailLot.current = { id: task.id, doc: latest };
            await refreshQueue.current?.();
          }
          else {
            const snap = await store.doc(`lots/${task.id}`).get().catch(() => null);
            const latest = snap?.exists ? readLot(snap.data()) : null;
            if (latest) {
              openLots.current = openLots.current.filter((l) => l.id !== task.id);
              closedLots.current = closedLots.current.filter((l) => l.id !== task.id);
              (latest.open ? openLots : closedLots).current.push({ id: task.id, doc: latest });
            }
          }
          return false;
        }
        if (code === 'gone') {
          toast('this lot was removed on another device', 4000);
          return false;
        }
        const f = describe(e, 'store');
        if (f.code === 'invalid_argument') dispatch({ type: 'connected', canWrite: false });
        toast(f.ambiguous ? 'couldn’t confirm the save · check again in a moment' : `not saved · ${f.text}`, 5200);
        return false;
      } finally {
        writing.current.delete(task.id);
        dispatch({ type: 'pending', id: task.id, on: false });
        render();
      }
    },
    [toast, render],
  );


  /* ——— the recording clocks (§3: simulated; the transcript, when the browser can, is real) ——— */

  const clocks = useRef<number[]>([]);
  useEffect(() => {
    clocks.current.forEach(window.clearInterval);
    clocks.current = [];
    if (!state.recording) return;
    clocks.current = [
      window.setInterval(() => dispatch({ type: 'second' }), 1000),
      window.setInterval(
        () => dispatch({ type: 'levels', levels: Array.from({ length: BARS }, () => 4 + Math.random() * 36) }),
        200,
      ),
    ];
    return () => {
      clocks.current.forEach(window.clearInterval);
      clocks.current = [];
    };
  }, [state.recording]);

  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const noteRef = useRef(state.slip.note);
  noteRef.current = state.slip.note;

  /** Detach every handler before stopping, so a late result cannot overwrite an edit. */
  const stopDictation = useCallback(() => {
    const rec = recognizer.current;
    recognizer.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    dispatch({ type: 'recording', on: false });
  }, []);

  useEffect(() => () => stopDictation(), [stopDictation]);

  // leaving the slip by any route — a lot that left the list included — ends the dictation
  useEffect(() => {
    if (state.screen !== 'handoff' && recognizer.current) stopDictation();
  }, [state.screen, stopDictation]);

  const startDictation = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      dispatch({ type: 'slip', patch: { mode: 'written' } });
      toast('dictation isn’t available here — type it instead', 4000);
      return;
    }
    let rec: SpeechRecognitionLike;
    try {
      rec = new SR();
    } catch {
      dispatch({ type: 'slip', patch: { mode: 'written' } });
      toast('dictation isn’t available here — type it instead', 4000);
      return;
    }
    const base = noteRef.current.trim();
    rec.lang = navigator.language || 'pt-BR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let heard = '';
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        heard += r[0].transcript + (r.isFinal ? ' ' : '');
      }
      dispatch({ type: 'slip', patch: { note: `${base ? `${base} ` : ''}${heard}`.replace(/\s+/g, ' ').trim() } });
    };
    rec.onerror = (ev) => {
      const code = ev?.error;
      stopDictation();
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
        dispatch({ type: 'slip', patch: { mode: 'written' } });
        toast('the microphone isn’t available here — type it instead', 4000);
      } else if (code && code !== 'aborted' && code !== 'no-speech') {
        toast(`dictation stopped (${code}) — record more or type it`, 4000);
      }
    };
    rec.onend = () => {
      if (recognizer.current === rec) stopDictation();
    };
    try {
      rec.start();
    } catch {
      dispatch({ type: 'slip', patch: { mode: 'written' } });
      toast('dictation isn’t available here — type it instead', 4000);
      return;
    }
    recognizer.current = rec;
    dispatch({ type: 'recording', on: true });
  }, [stopDictation, toast]);

  /* ——— derived ——— */

  const selected = useMemo(
    () => state.tasks.find((t) => t.id === state.selectedId) ?? null,
    [state.tasks, state.selectedId],
  );

  const view = useMemo(() => buildListView(state.tasks, state.tab), [state.tasks, state.tab]);

  /** The lot number the next blank label will carry — a preview; the counter hands out the real one at print. */
  const nextLot = useMemo(
    () => state.tasks.reduce((max, t) => Math.max(max, t.lot), 0) + 1,
    [state.tasks],
  );

  /* ——— the actions the screens call ——— */

  const inbox = state.mode === 'inbox';
  const actor = state.who ?? (cloud.current ? null : 'carla');

  const actions = useMemo(
    () => ({
      setTab: (tab: Tab) => { if (actor !== 'barbara') dispatch({ type: 'tab', tab }); },
      open: (task: Task) => { if (actor !== 'barbara' || isBarbaraPending(task)) dispatch({ type: 'open', id: task.id }); },
      back: () => {
        stopDictation();
        dispatch({ type: 'back' });
        render();
      },
      compose: () => { if (actor !== 'barbara') dispatch({ type: 'compose' }); },
      patchDraft: (patch: Partial<Draft>) => dispatch({ type: 'draft', patch }),
      patchSlip: (patch: Partial<SlipDraft>) => dispatch({ type: 'slip', patch }),
      sync: () => { if (actor !== 'barbara') void readMail(); },
      refreshReview: () => void refreshQueue.current?.(),
      toggleShowAll: () => {
        const on = !showAllRef.current;
        showAllRef.current = on;
        dispatch({ type: 'showAll', on });
        render();
      },

      /** This device says who it is and asks to join; a member allows it on theirs. */
      pairAs: async (who: Who) => {
        dispatch({ type: 'pair', pair: { phase: 'asking', who } });
        try {
          const ask = await askToJoin(who);
          waitForYes(ask, cloudUnsubs.current, () => cloudAlive.current);
        } catch (e) {
          const x = e as CallError;
          dispatch({ type: 'pair', pair: { phase: 'error', who, note: x?.status === 429 ? 'too many devices are waiting · try again in a while' : 'no connection · try again' } });
        }
      },
      pairAgain: () => {
        forgetAsk();
        if (pollJoin.current) window.clearInterval(pollJoin.current);
        pollJoin.current = null;
        dispatch({ type: 'pair', pair: { phase: 'who' } });
      },
      /** words: what she typed from the new phone to allow it; null turns it away. */
      decideJoin: async (id: string, words: string | null): Promise<boolean> => {
        try {
          const v = await decideJoin(id, words);
          const said: Record<string, string> = {
            approved: 'allowed · the device is joining',
            wrong: 'those aren’t the words on that phone · check and try again',
            denied: words === null ? 'turned away' : 'three wrong tries · turned away',
            expired: 'that ask is too old · start again on the new phone',
            gone: 'that ask was already answered',
            not_allowed: 'this device can’t allow others',
          };
          toast(said[v] ?? 'couldn’t save that · try again', v === 'approved' || v === 'denied' ? 2600 : 4600);
          return v !== 'wrong';
        } catch {
          toast('couldn’t save that · try again', 4000);
          return false;
        }
      },
      connectGmail: async () => {
        try {
          await connectGmail();
        } catch (e) {
          const x = e as CallError;
          toast(x?.message && x.status === 409 ? x.message : 'couldn’t start connecting gmail · try again', 5200);
        }
      },

      /** "prepare the reply": the robot reads the whole thread and drafts it — on her tap only. */
      prepare: (task: Task) => {
        if (actor === 'barbara' || task.prepared?.review !== 'pending') return;
        if (robotRef.current.on === task.id) return stopOne();
        void draftOne(task.id);
      },

      toggleDone: (task: Task) => {
        if (!inbox) return dispatch({ type: 'toggleDone', id: task.id });
        if (state.pending[task.id] || actor !== 'carla') return;
        const kind = task.done ? 'reopen' : 'approve';
        void write(task, (doc) => reviewPatch(doc, actor, { kind }, nowIso()), kind === 'reopen' ? 'reopened' : 'approved · with barbara');
      },

      /** This confirms work Barbara already carried out; it does not send mail. */
      complete: (task: Task) => {
        if (!inbox || state.pending[task.id] || actor !== 'barbara') return;
        void write(task, (doc) => reviewPatch(doc, actor, { kind: 'complete' }, nowIso()), 'marked as handled').then((ok) => {
          if (ok) { detailLot.current = null; dispatch({ type: 'back' }); }
        });
      },

      returnProposal: async (task: Task, proposal: string): Promise<boolean> => {
        if (!inbox || state.pending[task.id] || actor !== 'barbara') return false;
        const ok = await write(task, (doc) => reviewPatch(doc, actor, { kind: 'return', proposal }, nowIso()), 'returned to carla for approval');
        if (ok) { detailLot.current = null; dispatch({ type: 'back' }); }
        return ok;
      },

      act: (task: Task) => dispatch({ type: 'act', id: task.id }),

      discard: (task: Task) => {
        if (!inbox) return dispatch({ type: 'discard', id: task.id });
        if (state.pending[task.id] || actor !== 'carla') return;
        void write(task, (doc) => reviewPatch(doc, actor, { kind: 'file' }, nowIso()), 'filed').then((ok) => {
          if (ok) dispatch({ type: 'back' });
        });
      },

      handoff: (task: Task) => {
        if (inbox && actor !== 'carla') return;
        dispatch({ type: 'handoff', id: task.id });
        if (inbox) dispatch({ type: 'slip', patch: { approval: true, mode: (window.SpeechRecognition || window.webkitSpeechRecognition) ? 'voice' : 'written' } });
      },

      record: (on: boolean) => {
        if (!inbox) return dispatch({ type: 'recording', on });
        if (on) startDictation();
        else stopDictation();
      },

      hand: () => {
        if (!inbox) return dispatch({ type: 'hand' });
        const task = selected;
        if (!task || state.pending[task.id] || actor !== 'carla') return;
        const note = state.slip.note.trim();
        if (!note || state.recording) return;
        stopDictation();
        // Keep the editor and its transcript until the shared record confirms it.
        void write(task, (doc) => reviewPatch(doc, actor, {
          kind: 'feedback', note, mode: state.slip.mode, secs: state.slip.secs,
        }, nowIso()), 'feedback sent to barbara').then((ok) => {
          if (ok) dispatch({ type: 'open', id: task.id });
        });
      },

      create: async () => {
        if (actor === 'barbara') return;
        if (!inbox) return dispatch({ type: 'create' });
        const store = db.current;
        const title = state.draft.title.trim();
        if (!title) return;
        if (!store) {
          toast('the lot store isn’t available here', 4000);
          return;
        }
        const chip = COMPOSE_CONTEXTS.find((c) => c.chip === state.draft.context) ?? COMPOSE_CONTEXTS[0];
        const { bucket, dueAt } = resolveDue(state.draft.due);
        const id = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        dispatch({ type: 'pending', id: 'new', on: true });
        try {
          const lot = await claimLots(store, holder.current, 1, maxLot() + 1);
          const now = nowIso();
          const triage = {
            category: chip.category,
            actionRequired: true,
            priority: 'Medium',
            nextAction: title.toLowerCase(),
            summary: '',
            ...(dueAt ? { dueAt, dueHasTime: false } : {}),
          };
          const doc: LotDoc = {
            v: 2,
            lot,
            kind: 'manual',
            subject: title,
            receivedAt: now,
            triage,
            draft: null,
            robot: null,
            review: 'pending',
            completed: false,
            ...flagsOf({ kind: 'manual', triage, review: 'pending', completed: false }),
            createdAt: now,
            updatedAt: now,
          };
          await store.doc(`lots/${id}`).set(clean(doc) as unknown as Record<string, unknown>);
          // move her only if she is still on the blank label — she may have gone elsewhere meanwhile
          if (screenRef.current === 'compose') {
            dispatch({ type: 'back' });
            dispatch({ type: 'tab', tab: bucket === 'today' ? 'today' : 'upcoming' });
          }
          toast('printed');
        } catch (e) {
          const f = describe(e, 'store');
          if (f.code === 'invalid_argument') dispatch({ type: 'connected', canWrite: false });
          toast(f.ambiguous ? 'couldn’t confirm the print · look for it in a moment' : `not printed · ${f.text}`, 5200);
        } finally {
          dispatch({ type: 'pending', id: 'new', on: false });
        }
      },
    }),
    [actor, inbox, selected, state.pending, state.slip, state.recording, state.draft, readMail, draftOne, stopOne, render, write, toast, startDictation, stopDictation, waitForYes],
  );

  return { state, selected, view, nextLot, actions };
}

/** The connector answered for a mailbox the studio notes don't name — the robot writes nothing. */
function wrongMailbox(found: string, expected: string): Failure {
  return {
    source: 'gmail',
    code: 'wrong_mailbox',
    text: expected
      ? `gmail is connected to ${found}, not ${expected} · the robot reads only the studio mailbox`
      : `the robot doesn’t know which mailbox is the studio’s yet · gmail answered as ${found}`,
    retryable: false,
    retryAfterMs: 0,
    ambiguous: false,
    terminal: false,
  };
}
