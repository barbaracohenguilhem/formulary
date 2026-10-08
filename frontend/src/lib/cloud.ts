/*
 * The cloud build: Formulary on its own address, its lots in Supabase, its robot in
 * Supabase Edge Functions. A device joins once — pairing — and keeps an ordinary
 * Supabase session in its own storage (the refresh token never expires), so Carla's
 * phone opens straight into her inbox, with no email, code or password.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { inArtifact } from './runtime';

const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
const KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) ?? '';

export type Who = 'carla' | 'barbara';

/** This build talks to Supabase: configured, and not running inside claude.ai (the artifact keeps its own engine). */
export const cloudConfigured = () => !!URL_ && !!KEY && !inArtifact();

let client: SupabaseClient | null = null;
export const sb = () =>
  (client ??= createClient(URL_, KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'formulary.auth' },
  }));

/** Ask the browser to keep this app's storage — the session lives there. Harmless when refused. */
export const keepStorage = () => {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* fine */
  }
};

export async function currentWho(): Promise<Who | null> {
  const { data } = await sb().auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return null;
  const { data: p } = await sb().from('people').select('who').eq('user_id', uid).maybeSingle();
  return p?.who === 'carla' || p?.who === 'barbara' ? p.who : null;
}

/** A failure the functions or the network produced, shaped like the app's own. */
export type CallError = { code: string; message: string; status?: number };

export async function call<T = Record<string, unknown>>(fn: 'robot' | 'pair' | 'gmail-auth', body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { apikey: KEY, 'Content-Type': 'application/json' };
  if (fn !== 'pair') {
    const { data } = await sb().auth.getSession();
    if (!data.session) throw { code: 'revoked', message: 'signed out' } satisfies CallError;
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let r: Response;
  try {
    r = await fetch(`${URL_}/functions/v1/${fn}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw { code: 'cancelled', message: 'stopped' } satisfies CallError;
    throw { code: 'unavailable', message: 'no connection' } satisfies CallError;
  }
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (r.status === 401) throw { code: 'revoked', message: j.error ?? 'not allowed', status: 401 } satisfies CallError;
  if (!r.ok) throw { code: r.status === 429 ? 'resource_exhausted' : 'unavailable', message: j.error ?? r.statusText, status: r.status } satisfies CallError;
  return j;
}

/* ——— pairing ——— */

const PAIR_KEY = 'formulary.pair';

export type PairAsk = { id: string; token: string; words: string; who: Who };

export const deviceLabel = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows computer';
  return 'browser';
};

export const savedAsk = (): PairAsk | null => {
  try {
    return JSON.parse(localStorage.getItem(PAIR_KEY) || 'null') as PairAsk | null;
  } catch {
    return null;
  }
};

const saveAsk = (a: PairAsk | null) => {
  try {
    if (a) localStorage.setItem(PAIR_KEY, JSON.stringify(a));
    else localStorage.removeItem(PAIR_KEY);
  } catch {
    /* the ask still works for this visit */
  }
};

export async function askToJoin(who: Who): Promise<PairAsk> {
  const r = await call<{ id: string; token: string; words: string; error?: string }>('pair', { action: 'request', who, label: deviceLabel() });
  const ask = { id: r.id, token: r.token, words: r.words, who };
  saveAsk(ask);
  return ask;
}

export type PairState = 'pending' | 'issued' | 'denied' | 'expired' | 'unknown' | 'approved';

/** Poll once; when a member has allowed the device, the session lands here and is kept. */
export async function checkJoin(ask: PairAsk): Promise<PairState> {
  const r = await call<{ status: PairState; session?: { access_token: string; refresh_token: string } }>('pair', { action: 'status', token: ask.token });
  if (r.session) {
    const { error } = await sb().auth.setSession(r.session);
    if (error) throw { code: 'unavailable', message: error.message } satisfies CallError;
    saveAsk(null);
    return 'issued';
  }
  if (r.status === 'denied' || r.status === 'expired' || r.status === 'unknown' || r.status === 'issued') saveAsk(null);
  return r.status;
}

export const forgetAsk = () => saveAsk(null);

/* ——— devices waiting for a yes ——— */

export type JoinRequest = { id: string; who: Who; label: string; createdAt: string };

export function watchJoinRequests(next: (reqs: JoinRequest[]) => void): () => void {
  let alive = true;
  const load = async () => {
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data } = await sb().from('devices').select('id, who, label, created_at').eq('status', 'pending').gte('created_at', since).order('created_at', { ascending: false });
    if (alive) next((data ?? []).map((d) => ({ id: d.id, who: d.who as Who, label: d.label, createdAt: d.created_at })));
  };
  void load();
  const channel = sb().channel(`formulary-devices-${Math.random().toString(36).slice(2, 10)}`).on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => void load()).subscribe();
  const every = setInterval(load, 20_000);
  return () => {
    alive = false;
    clearInterval(every);
    void sb().removeChannel(channel);
  };
}

export type JoinVerdict = 'approved' | 'wrong' | 'denied' | 'expired' | 'gone' | 'not_allowed';

/** Allow — only with the two words typed from the new phone — or turn away. The server decides. */
export async function decideJoin(id: string, words: string | null): Promise<JoinVerdict> {
  const { data, error } = words === null ? await sb().rpc('deny_device', { p_id: id }) : await sb().rpc('approve_device', { p_id: id, p_words: words });
  if (error) throw { code: 'invalid_argument', message: error.message } satisfies CallError;
  return String(data) as JoinVerdict;
}

/* ——— gmail, connected once ——— */

export async function connectGmail() {
  const { url } = await call<{ url: string }>('gmail-auth', { action: 'start' });
  window.location.href = url;
}

/** What the server says about the robot's three dependencies. */
export type RobotStatus = { gmail: { connected: boolean; email: string }; claude: boolean; google: boolean; unread: number; mailbox: string };
