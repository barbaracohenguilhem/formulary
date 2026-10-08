/*
 * The mailbox, read through the viewer's own Gmail connector. Read-only by design:
 * the product never sends, labels or archives — Barbara carries out an approved
 * action by hand. Shapes below were observed on real calls of this connector:
 *
 *   search_threads { query, pageSize, pageToken? } → { threads: [{ id, messages: [meta], viewUrl }], nextPageToken }
 *   get_thread     { threadId }                    → { id, messages: [meta + htmlBody], viewUrl }
 *
 * meta = { id, threadId, date (ISO), internalDate (ms, string), labelIds[], sender (address),
 *          subject, snippet, toRecipients[], ccRecipients[], viewUrl }
 */
import type { Mcp, McpResult } from './runtime';

export const GMAIL = 'Gmail';
export const TOOLS = { search: 'search_threads', get: 'get_thread' } as const;

export type MessageMeta = {
  id: string;
  at: number; // epoch ms
  labels: string[];
  sender: string;
  subject: string;
  snippet: string;
  to: string[];
  cc: string[];
};

export type ThreadMeta = {
  threadId: string;
  messages: MessageMeta[]; // oldest first
  viewUrl: string;
  mailbox: string;
};

const str = (v: unknown) => (v == null ? '' : String(v));
const arr = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Gmail snippets arrive HTML-escaped ("AD&#39;s"). */
export const unescapeHtml = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const safeUrl = (u: string) => (/^https:\/\/mail\.google\.com\//i.test(u) ? u : '');

/** Which mailbox a thread was read from: the connector's own `authuser`. */
export const mailboxOf = (viewUrl: string) => {
  const m = viewUrl.match(/[?&]authuser=([^&#]+)/);
  return m ? decodeURIComponent(m[1]).toLowerCase() : '';
};

export function payloadOf(res: McpResult): Record<string, unknown> {
  let p: unknown = res?.payload;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      p = null;
    }
  }
  if ((p == null || typeof p !== 'object') && res?.content?.[0]?.text) {
    try {
      p = JSON.parse(res.content[0].text);
    } catch {
      p = null;
    }
  }
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
}

const messageOf = (m: Record<string, unknown>): MessageMeta => {
  const ms = Number(m.internalDate);
  const at = Number.isFinite(ms) && ms > 0 ? ms : Date.parse(str(m.date)) || 0;
  return {
    id: str(m.id),
    at,
    labels: arr(m.labelIds),
    sender: str(m.sender).toLowerCase(),
    subject: unescapeHtml(str(m.subject)).trim(),
    snippet: unescapeHtml(str(m.snippet)).trim(),
    to: arr(m.toRecipients).map((s) => s.toLowerCase()),
    cc: arr(m.ccRecipients).map((s) => s.toLowerCase()),
  };
};

export function threadOf(t: Record<string, unknown>): ThreadMeta | null {
  const threadId = str(t.id || t.threadId);
  // unsent drafts are nobody's message yet
  const messages = (Array.isArray(t.messages) ? t.messages : [])
    .map((m) => messageOf((m ?? {}) as Record<string, unknown>))
    .filter((m) => !m.labels.includes('DRAFT'))
    .sort((a, b) => a.at - b.at);
  if (!threadId || messages.length === 0) return null;
  const viewUrl = safeUrl(str(t.viewUrl));
  return { threadId, messages, viewUrl, mailbox: mailboxOf(viewUrl) };
}

/**
 * Every thread matching `query`, following pages up to `maxPages`. `truncated` says
 * more remain than were read, so the caller never treats a partial list as complete.
 */
export async function listThreads(
  mcp: Mcp,
  query: string,
  { pageSize = 50, maxPages = 6, signal }: { pageSize?: number; maxPages?: number; signal?: AbortSignal } = {},
): Promise<{ threads: ThreadMeta[]; truncated: boolean }> {
  const threads: ThreadMeta[] = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page++) {
    const res = await mcp.callTool(
      GMAIL,
      TOOLS.search,
      { query, pageSize, ...(pageToken ? { pageToken } : {}) },
      { cache: false, ...(signal ? { signal } : {}) },
    );
    const p = payloadOf(res);
    for (const t of Array.isArray(p.threads) ? p.threads : []) {
      const th = threadOf((t ?? {}) as Record<string, unknown>);
      if (th) threads.push(th);
    }
    pageToken = str(p.nextPageToken);
    if (!pageToken) return { threads, truncated: false };
  }
  return { threads, truncated: true };
}

/* ——— the letter itself, as text ——— */

/** Plain text of one message body, quoted history removed. DOMParser documents are inert: nothing loads or runs. */
export function bodyText(m: Record<string, unknown>): string {
  const plain = str(m.plaintextBody || m.plainTextBody || m.textBody || m.bodyText || m.text);
  const text = plain ? plain : htmlText(str(m.htmlBody || m.body));
  return stripQuoted(text);
}

/** Without a DOM: cut quoted history by its markers, then drop the tags. Never renders anything. */
function roughText(html: string): string {
  return html
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<blockquote[\s\S]*$/i, ' ')
    .replace(/<div[^>]*class="[^"]*gmail_quote[\s\S]*$/i, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-4])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlText(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return roughText(html);
  try {
    return domText(html);
  } catch {
    return roughText(html);
  }
}

function domText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,head,title,.gmail_quote,blockquote,.yahoo_quoted,#appendonsend,[id^="divRplyFwdMsg"]').forEach((n) => n.remove());
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4').forEach((n) => n.append('\n'));
  return doc.body?.textContent ?? '';
}

function stripQuoted(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    // the reply chain starts here — everything below is history the robot already saw
    if (/^On .{6,200} wrote:$/i.test(l) || /^Em .{6,200} escreveu:$/i.test(l) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l)) break;
    if (/^From:\s.+/i.test(l) && out.length > 3 && /^(Sent|Date|Enviado|Data):/i.test(lines[i + 1]?.trim() ?? '')) break;
    if (l.startsWith('>')) continue;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A message time in the viewer's zone with its offset: "2026-09-28 15:56 -04:00". */
export function localStamp(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

export type ThreadText = {
  text: string; // oldest → newest, each message headed with sender and date, capped
  attachments: boolean;
};

/** The thread as the robot reads it: newest messages kept whole, the oldest trimmed first. */
export async function threadText(mcp: Mcp, threadId: string, maxChars = 8000, signal?: AbortSignal): Promise<ThreadText> {
  const res = await mcp.callTool(GMAIL, TOOLS.get, { threadId }, { cache: false, ...(signal ? { signal } : {}) });
  const p = payloadOf(res);
  const raw = (Array.isArray(p.messages) ? p.messages : []) as Record<string, unknown>[];
  const parts = raw
    .map((m) => ({ meta: messageOf(m), body: bodyText(m), attach: Array.isArray(m.attachments) && m.attachments.length > 0 }))
    .filter((p) => !p.meta.labels.includes('DRAFT'))
    .sort((a, b) => a.meta.at - b.meta.at);
  const blocks: string[] = [];
  let used = 0;
  for (const part of [...parts].reverse()) {
    const head = `— from ${part.meta.sender} · ${localStamp(part.meta.at)}${part.meta.to.length ? ` · to ${part.meta.to.join(', ')}` : ''}${part.meta.cc.length ? ` · cc ${part.meta.cc.join(', ')}` : ''}`;
    const room = maxChars - used - head.length - 2;
    if (room < 200 && blocks.length > 0) break;
    const body = part.body.length > room ? `${part.body.slice(0, Math.max(0, room - 1))}…` : part.body;
    blocks.unshift(`${head}\n${body || part.meta.snippet}`);
    used += head.length + body.length + 2;
  }
  return { text: blocks.join('\n\n'), attachments: parts.some((x) => x.attach) };
}
