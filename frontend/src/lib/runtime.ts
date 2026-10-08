/*
 * The slice of the claude.ai artifact runtime this app uses (contract 0.2.63).
 * `window.claude.use(name)` is the only promised member; every namespace may
 * resolve null, and the app is designed for that absence.
 */

export type McpResult = {
  payload?: unknown;
  content?: { type: string; text?: string }[];
  cache?: { storedAt: number; revalidating: boolean };
};

export type Mcp = {
  callTool(server: string, tool: string, input?: unknown, options?: { cache?: false; signal?: AbortSignal }): Promise<McpResult>;
};

export type DocSnap = {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
};

export type QuerySnap = {
  docs: DocSnap[];
  size: number;
  empty: boolean;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
};

export type DbError = { code: string; message: string };

export type DocRef = {
  id: string;
  path: string;
  get(): Promise<DocSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  update(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  acquire(o: { holder: string; ttlMs?: number; data?: Record<string, unknown> }): Promise<{ acquired: boolean; expiresAt?: string }>;
  onSnapshot(next: (s: DocSnap) => void, error?: (e: DbError) => void): () => void;
  collection?(path: string): Collection;
};

export type Query = {
  where(field: string, op: string, value: unknown): Query;
  orderBy(field: string, dir?: 'asc' | 'desc'): Query;
  limit(n: number): Query;
  get(): Promise<QuerySnap>;
  onSnapshot(next: (s: QuerySnap) => void, error?: (e: DbError) => void): () => void;
};

export type Collection = Query & { path: string; doc(id?: string): DocRef };

export type Db = {
  doc(path: string): DocRef;
  collection(path: string): Collection;
};

export type SampleOptions = {
  signal?: AbortSignal;
  modelTier?: 'default' | 'complex' | 'quick';
  /** Cloud robot only (the artifact runtime ignores unknown members): the Claude model, effort, and output shape. */
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  schema?: 'triage' | 'draft';
  cache?: boolean | { gcTime?: number; refresh?: boolean };
  onText?: (u: { text: string; delta: string }) => void;
};

export type Sample = {
  (input: string, options?: SampleOptions): Promise<{ text: string; truncated: boolean }>;
  json<T = unknown>(input: string, options?: SampleOptions): Promise<T>;
};

export type User = {
  isOwner(): Promise<boolean>;
  canEdit(): Promise<boolean>;
  can(name: string): Promise<boolean | null>;
  id(): Promise<string | null>;
};

/** True when this page runs inside the artifact runtime. */
export const inArtifact = () => typeof window !== 'undefined' && !!window.claude;

/** A capability namespace, or null when this view cannot run it. Never throws. */
export async function use<T>(name: string, check: (ns: unknown) => boolean): Promise<T | null> {
  if (!inArtifact()) return null;
  try {
    const ns = await window.claude!.use(name);
    return ns && check(ns) ? (ns as T) : null;
  } catch {
    return null;
  }
}

export const useDb = () => use<Db>('db', (n) => typeof (n as Db).collection === 'function');
export const useMcp = () => use<Mcp>('mcp', (n) => typeof (n as Mcp).callTool === 'function');
export const useSample = () => use<Sample>('sample', (n) => typeof n === 'function' && typeof (n as Sample).json === 'function');
export const useUser = () => use<User>('user', (n) => typeof (n as User).isOwner === 'function');
