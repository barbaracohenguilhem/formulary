/** A Gmail web target, never an inbox homepage masquerading as the source email. */
type GmailTarget = { gmail?: string; threadId?: string; mailbox?: string };

// Gmail's API thread IDs currently used by this app are hexadecimal. In
// particular, an RFC Message-ID (<…@…>) or a local lot ID is not a thread ID.
const API_THREAD_ID = /^[a-f0-9]{1,64}$/i;
const THREAD_ROUTE = /^#(?:all|inbox|sent|starred|important|snoozed|spam|trash|drafts)\/[a-z0-9_-]{1,128}$/i;

function address(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email && email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(email)
    ? email
    : undefined;
}

function gmailUrl(value: string | undefined): URL | undefined {
  if (!value || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'mail.google.com' || url.port || url.username || url.password) return undefined;
    if (!/^\/mail(?:\/u\/\d+)?\/?$/.test(url.pathname)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/** Only a validated Gmail URL may identify the mailbox read by the connector. */
export function gmailMailbox(value: string | undefined): string {
  const url = gmailUrl(value);
  return address(url?.searchParams.get('authuser') ?? undefined) ?? '';
}

/**
 * Keep the connector's specific thread route when available. Otherwise use the
 * stored API thread ID, never a subject search, a Message-ID header, or a lot ID.
 * An explicit mailbox wins over a browser-specific /u/0 account index.
 * This is a web URL; native Gmail app handoff still depends on the device.
 */
export function gmailLink({ gmail, threadId, mailbox }: GmailTarget): string | undefined {
  const url = gmailUrl(gmail);
  const box = address(mailbox) || gmailMailbox(gmail);
  if (mailbox?.trim() && !address(mailbox)) return undefined;

  let hash = url && THREAD_ROUTE.test(url.hash) ? url.hash : undefined;
  let linkedId = hash?.slice(hash.lastIndexOf('/') + 1);
  // Older Gmail permalinks identify a thread with `th` instead of a hash route.
  if (!hash) {
    linkedId = url?.searchParams.get('th') ?? undefined;
    if (linkedId && API_THREAD_ID.test(linkedId)) hash = `#all/${linkedId}`;
  }
  const storedId = threadId && API_THREAD_ID.test(threadId) ? threadId : undefined;
  // Compare only API-format IDs. Gmail's UI IDs (FMfc…) are a different
  // representation, so they must not be guessed from or compared to API IDs.
  if (hash && storedId && linkedId && API_THREAD_ID.test(linkedId) && linkedId.toLowerCase() !== storedId.toLowerCase()) {
    hash = `#all/${storedId}`;
  }
  if (!hash && storedId && box) hash = `#all/${storedId}`;
  if (!hash) return undefined;

  const target = new URL('https://mail.google.com/mail/');
  if (box) target.searchParams.set('authuser', box);
  else if (url) target.pathname = url.pathname;
  target.hash = hash;
  return target.href;
}
