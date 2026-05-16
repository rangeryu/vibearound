import type { ChatMessage } from "./chatTypes";

const DB_NAME = "vibearound-web-chat";
const DB_VERSION = 1;
const STORE_NAME = "session-transcripts";
const MAX_CACHED_SESSIONS = 5;
const KEY_SEPARATOR = "\u001f";

interface CacheKeyParts {
  agentId: string;
  workspace: string;
  sessionId: string;
}

interface CacheReadRequest extends CacheKeyParts {
  updatedAt: number;
}

interface CacheWriteRequest extends CacheReadRequest {
  messages: ChatMessage[];
}

interface CachedSessionTranscript {
  key: string;
  agentId: string;
  workspace: string;
  sessionId: string;
  updatedAt: number;
  cachedAt: number;
  messages: ChatMessage[];
}

function cacheKey({ agentId, workspace, sessionId }: CacheKeyParts) {
  return [agentId, workspace, sessionId].join(KEY_SEPARATOR);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function openSessionCache(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
): Promise<T | null> {
  const db = await openSessionCache();
  if (!db) return null;
  try {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const result = await callback(store);
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

async function pruneCachedSessions(store: IDBObjectStore) {
  const entries = await requestResult<CachedSessionTranscript[]>(store.getAll());
  if (entries.length <= MAX_CACHED_SESSIONS) return;

  entries
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .slice(MAX_CACHED_SESSIONS)
    .forEach((entry) => {
      store.delete(entry.key);
    });
}

export async function readCachedChatSession({
  agentId,
  workspace,
  sessionId,
  updatedAt,
}: CacheReadRequest): Promise<ChatMessage[] | null> {
  const key = cacheKey({ agentId, workspace, sessionId });
  return withStore("readwrite", async (store) => {
    const entry = await requestResult<CachedSessionTranscript | undefined>(store.get(key));
    if (!entry || entry.updatedAt !== updatedAt) return null;
    store.put({ ...entry, cachedAt: Date.now() });
    return entry.messages;
  });
}

export async function writeCachedChatSession({
  agentId,
  workspace,
  sessionId,
  updatedAt,
  messages,
}: CacheWriteRequest): Promise<void> {
  const key = cacheKey({ agentId, workspace, sessionId });
  await withStore("readwrite", async (store) => {
    store.put({
      key,
      agentId,
      workspace,
      sessionId,
      updatedAt,
      cachedAt: Date.now(),
      messages,
    } satisfies CachedSessionTranscript);
    await pruneCachedSessions(store);
  });
}

export async function deleteCachedChatSession({
  agentId,
  workspace,
  sessionId,
}: CacheKeyParts): Promise<void> {
  const key = cacheKey({ agentId, workspace, sessionId });
  await withStore("readwrite", async (store) => {
    store.delete(key);
  });
}
