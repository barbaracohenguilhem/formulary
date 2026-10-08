/*
 * Failures, in the viewer's words. Three things can fail and each has its own fix:
 * the mailbox (the Gmail connector), the robot (Claude, reached through `sample`),
 * and the store (the artifact's own database). Codes are the contract's; copy
 * names the one action that fixes it, never a generic "something went wrong"
 * for a code that has a distinct fix.
 */

export type Source = 'gmail' | 'claude' | 'store';

export type Failure = {
  source: Source;
  code: string;
  text: string;
  retryable: boolean;
  retryAfterMs: number;
  /** A write may still have run — say so rather than claim it failed. */
  ambiguous: boolean;
  /** Nothing this view can do will fix it this load: stop calling. */
  terminal: boolean;
};

const MCP_CODES = new Set([
  'needs_reauth', 'server_not_connected', 'selection_required', 'server_not_found', 'server_unavailable',
  'not_in_manifest', 'blocked_by_policy', 'approval_required', 'tool_error', 'bad_request', 'cancelled',
  'rate_limited', 'upstream_error', 'not_granted', 'capability_disabled', 'capability_removed',
  'transform_error', 'consent_required', 'user_changed',
]);

const SAMPLE_CODES = new Set([
  'invalid_request', 'prompt_too_large', 'images_unavailable', 'tools_unavailable', 'image_rejected',
  'cancelled', 'not_granted', 'session_expired', 'sampling_disabled', 'not_declared', 'rate_limited',
  'refused', 'empty_completion', 'invalid_json', 'upstream_error', 'capability_disabled',
  'capability_removed', 'transform_error', 'queue_overflow', 'budget_spent',
]);

const DB_CODES = new Set([
  'invalid_argument', 'resource_exhausted', 'quota_exceeded', 'unavailable', 'revoked', 'not_granted',
  'capability_disabled', 'capability_removed', 'transform_error',
]);

const GMAIL_COPY: Record<string, string> = {
  server_not_connected: 'gmail isn’t connected · add it in claude.ai settings → connectors',
  needs_reauth: 'gmail needs reconnecting · claude.ai settings → connectors',
  selection_required: 'choose which gmail account to use when claude asks',
  server_not_found: 'the gmail connector is gone · add it again in claude.ai settings',
  not_in_manifest: 'gmail was declined for this page · allow it from the page’s permissions menu',
  consent_required: 'allow gmail for this page, then tap ↻',
  blocked_by_policy: 'your organisation blocks gmail here',
  approval_required: 'gmail needs approval in claude.ai before the robot can read',
  server_unavailable: 'gmail didn’t answer · tap ↻ to try again',
  rate_limited: 'gmail is busy · wait a moment, then tap ↻',
  not_granted: 'this page has no gmail access · reload and allow it',
  capability_disabled: 'connectors aren’t available in this view',
  capability_removed: 'connectors aren’t available in this view',
  user_changed: 'account changed · reload the page',
};

const CLAUDE_COPY: Record<string, string> = {
  not_granted: 'the robot needs your permission to read · allow claude for this page',
  sampling_disabled: 'claude isn’t available on this account, so the robot can’t read new mail',
  not_declared: 'the robot is switched off on this version',
  capability_disabled: 'the robot can’t run in this view',
  capability_removed: 'the robot can’t run in this view',
  session_expired: 'sign in to claude.ai again, then tap ↻',
  rate_limited: 'the robot hit your usage limit · it picks up again later',
  refused: 'the robot declined one letter · it is left for you as it came',
  prompt_too_large: 'one thread is too long for the robot · open it in gmail',
  invalid_json: 'the robot’s answer didn’t parse · tap ↻ to try again',
  empty_completion: 'the robot came back empty · tap ↻ to try again',
  upstream_error: 'the robot was interrupted · tap ↻ to try again',
};

const STORE_COPY: Record<string, string> = {
  quota_exceeded: 'the lot store is full · file or clear old lots',
  resource_exhausted: 'too much at once · wait a moment, then tap ↻',
  unavailable: 'the lot store didn’t answer · try again',
  revoked: 'this page lost access to its lots · reload',
  not_granted: 'this page has no lot store here',
  capability_disabled: 'the lot store isn’t available in this view',
  capability_removed: 'the lot store isn’t available in this view',
  invalid_argument: 'you can read these lots but not change them',
};

/** Where the fix lives: claude.ai (the artifact) or the app's own connect step (the cloud build). */
let voice: 'artifact' | 'cloud' = 'artifact';
export const setVoice = (v: 'artifact' | 'cloud') => {
  voice = v;
};

const GMAIL_CLOUD: Record<string, string> = {
  server_not_connected: 'gmail isn’t connected yet · tap connect gmail',
  needs_reauth: 'gmail needs reconnecting · tap connect gmail',
  server_unavailable: 'gmail didn’t answer · tap ↻ to try again',
  rate_limited: 'gmail is busy · wait a moment, then tap ↻',
  blocked_by_policy: 'google refused the robot’s access · check the workspace api settings',
};

const CLAUDE_CLOUD: Record<string, string> = {
  not_granted: 'the robot’s claude key is missing or was refused · check it in supabase',
  sampling_disabled: 'the robot’s claude key is missing · add it in supabase',
  rate_limited: 'claude is busy · the robot tries again shortly',
  upstream_error: 'claude was interrupted · tap ↻ to try again',
  invalid_request: 'the robot’s request was refused · tell claude code',
  budget_spent: 'the robot’s claude budget for today is spent · it picks up again tomorrow',
};

const TERMINAL: Record<Source, Set<string>> = {
  gmail: new Set(['not_granted', 'capability_disabled', 'capability_removed', 'user_changed', 'needs_reauth',
    'server_not_connected', 'server_not_found', 'not_in_manifest', 'blocked_by_policy', 'approval_required', 'selection_required']),
  claude: new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'session_expired']),
  store: new Set(['revoked', 'not_granted', 'capability_disabled', 'capability_removed']),
};

export function describe(e: unknown, source: Source): Failure {
  const err = (e ?? {}) as { code?: string; message?: string; retryable?: boolean; retryAfterMs?: number };
  const raw = err.code || '';
  const known = source === 'gmail' ? MCP_CODES : source === 'claude' ? SAMPLE_CODES : DB_CODES;
  const fallback = source === 'store' ? 'unavailable' : 'upstream_error';
  const code = known.has(raw) ? raw : fallback;
  const msg = (err.message || '').slice(0, 120);
  const base = source === 'gmail' ? GMAIL_COPY : source === 'claude' ? CLAUDE_COPY : STORE_COPY;
  const cloud = voice === 'cloud' ? (source === 'gmail' ? GMAIL_CLOUD : source === 'claude' ? CLAUDE_CLOUD : {}) : {};
  const copy: Record<string, string> = { ...base, ...cloud };
  const text =
    copy[code] ??
    (code === 'tool_error'
      ? `gmail refused the request${msg ? ` · ${msg}` : ''}`
      : `${source === 'store' ? 'the lot store' : source} failed · tap ↻${msg ? ` · ${msg}` : ''}`);
  return {
    source,
    code,
    text,
    retryable: err.retryable === true || (source === 'store' && code === 'unavailable'),
    retryAfterMs: err.retryAfterMs || 0,
    ambiguous: source === 'gmail' ? ['server_unavailable', 'upstream_error', 'cancelled'].includes(code) : source === 'store' && code === 'unavailable',
    terminal: TERMINAL[source].has(code),
  };
}
