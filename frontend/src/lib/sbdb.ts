/*
 * The artifact store's contract (runtime.ts: Db), kept on Supabase: one table of
 * documents addressed by path (public.docs), queried through generated columns,
 * merged by an RPC, leased by an RPC, and live through Realtime. Used by the app in
 * the browser (the member's own session, row-level security) and by the robot on the
 * server (the service role). Only what the app and the robot actually call is here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Collection, Db, DbError, DocRef, DocSnap, Query, QuerySnap } from './runtime';

/** Fields the app queries and orders by, and the columns that hold them. */
const COLUMN: Record<string, string> = {
  open: 'open',
  read: 'read',
  work: 'work',
  completed: 'completed',
  review: 'review',
  receivedAt: 'received_at',
  closedAt: 'closed_at',
  completedAt: 'completed_at',
};

const meta = { fromCache: false, hasPendingWrites: false };

/** Supabase and network failures, in the store's own codes (failure.ts reads these). */
function toDbError(e: unknown): DbError {
  const x = (e ?? {}) as { code?: string; message?: string; status?: number; name?: string };
  const msg = String(x.message ?? e ?? '');
  if (x.code === '42501' || /row-level security|permission denied/i.test(msg)) return { code: 'invalid_argument', message: msg };
  if (x.code === 'PGRST301' || /JWT|jwt expired/i.test(msg)) return { code: 'unavailable', message: msg };
  if (x.code === '23514' || x.code === '22P02') return { code: 'invalid_argument', message: msg };
  if (x.name === 'TypeError' || /fetch|network|timeout|Failed to fetch/i.test(msg)) return { code: 'unavailable', message: msg };
  return { code: 'unavailable', message: msg };
}

const snapOf = (path: string, doc: unknown): DocSnap => {
  const data = doc && typeof doc === 'object' ? (JSON.parse(JSON.stringify(doc)) as Record<string, unknown>) : undefined;
  return { id: path.split('/').pop() ?? path, exists: !!data, data: () => data, metadata: meta };
};

/** One channel for the whole table; every subscriber refetches its own view when anything changes. */
function liveHub(sb: SupabaseClient) {
  const subs = new Set<() => void>();
  let channel: ReturnType<SupabaseClient['channel']> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) return;
    // a burst of robot writes becomes one refetch
    timer = setTimeout(() => {
      timer = null;
      subs.forEach((f) => f());
    }, 250);
  };
  const open = () => {
    if (channel) return;
    channel = sb
      // a fresh topic each time: a channel being torn down under the same name would refuse new listeners
      .channel(`formulary-docs-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, fire)
      .subscribe();
  };
  return {
    add(f: () => void) {
      subs.add(f);
      open();
      return () => {
        subs.delete(f);
        if (subs.size === 0 && channel) {
          void sb.removeChannel(channel);
          channel = null;
        }
      };
    },
  };
}

export function supabaseDb(sb: SupabaseClient, { live = true }: { live?: boolean } = {}): Db {
  const hub = live ? liveHub(sb) : null;

  /** Also refetch now and then, and when the view comes back — Realtime can drop while a phone sleeps. */
  const watch = (refetch: () => void) => {
    const off = hub?.add(refetch) ?? (() => undefined);
    const every = setInterval(refetch, 60_000);
    const onShow = () => {
      if (typeof document !== 'undefined' && !document.hidden) refetch();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow);
    return () => {
      off();
      clearInterval(every);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShow);
    };
  };

  const docRef = (path: string): DocRef => {
    const get = async () => {
      const { data, error } = await sb.from('docs').select('doc').eq('path', path).maybeSingle();
      if (error) throw toDbError(error);
      return snapOf(path, data?.doc);
    };
    return {
    id: path.split('/').pop() ?? path,
    path,
    get,
    async set(doc: Record<string, unknown>) {
      const { error } = await sb.from('docs').upsert({ path, doc, updated_at: new Date().toISOString() });
      if (error) throw toDbError(error);
    },
    async update(patch: Record<string, unknown>) {
      const { data, error } = await sb.rpc('doc_merge', { p_path: path, p_patch: patch });
      if (error) throw toDbError(error);
      if (data == null) throw { code: 'invalid_argument', message: `no document at ${path}` } satisfies DbError;
    },
    async delete() {
      const { error } = await sb.from('docs').delete().eq('path', path);
      if (error) throw toDbError(error);
    },
    async acquire({ holder, ttlMs }) {
      const { data, error } = await sb.rpc('acquire_lease', { p_path: path, p_holder: holder, p_ttl_ms: ttlMs ?? 30_000 });
      if (error) throw toDbError(error);
      const r = (data ?? {}) as { acquired?: boolean; expiresAt?: string };
      return { acquired: !!r.acquired, expiresAt: r.expiresAt };
    },
    onSnapshot(next, error) {
      let alive = true;
      const refetch = () => {
        get().then(
          (s) => alive && next(s),
          (e) => alive && error?.(e as DbError),
        );
      };
      refetch();
      const stop = watch(refetch);
      return () => {
        alive = false;
        stop();
      };
    },
    collection(sub: string) {
      return collection(`${path}/${sub}`);
    },
    };
  };

  const query = (coll: string, wheres: [string, unknown][], order: [string, 'asc' | 'desc'] | null, lim: number): Query => {
    const run = async (): Promise<QuerySnap> => {
      let q = sb.from('docs').select('path, doc').eq('collection', coll);
      for (const [field, value] of wheres) q = q.eq(COLUMN[field] ?? field, value as never);
      if (order) q = q.order(COLUMN[order[0]] ?? order[0], { ascending: order[1] === 'asc', nullsFirst: false });
      const { data, error } = await q.limit(lim);
      if (error) throw toDbError(error);
      const docs = (data ?? []).map((r) => snapOf(r.path as string, r.doc));
      return { docs, size: docs.length, empty: docs.length === 0, metadata: meta };
    };
    const self: Query = {
      where(field, op, value) {
        if (op !== '==') throw new TypeError(`sbdb: only == is supported (got ${op})`);
        if (!COLUMN[field]) throw new TypeError(`sbdb: ${field} is not a queryable field`);
        return query(coll, [...wheres, [field, value]], order, lim);
      },
      orderBy(field, dir = 'asc') {
        if (!COLUMN[field]) throw new TypeError(`sbdb: ${field} is not an orderable field`);
        return query(coll, wheres, [field, dir], lim);
      },
      limit(n) {
        return query(coll, wheres, order, Math.max(1, Math.min(1000, n)));
      },
      get: run,
      onSnapshot(next, error) {
        let alive = true;
        let inFlight = false;
        let again = false;
        const refetch = () => {
          if (inFlight) {
            again = true;
            return;
          }
          inFlight = true;
          run()
            .then((s) => alive && next(s), (e) => alive && error?.(e as DbError))
            .finally(() => {
              inFlight = false;
              if (again && alive) {
                again = false;
                refetch();
              }
            });
        };
        refetch();
        const stop = watch(refetch);
        return () => {
          alive = false;
          stop();
        };
      },
    };
    return self;
  };

  const collection = (path: string): Collection => ({
    ...query(path, [], null, 1000),
    path,
    doc: (id?: string) => docRef(`${path}/${id ?? crypto.randomUUID()}`),
  });

  return { doc: docRef, collection };
}
