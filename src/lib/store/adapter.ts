/**
 * Counter storage, with two backends.
 *
 * Serverless instances are not sticky and share nothing, so a rate limit held
 * in module scope is really a per-instance limit — it works, but an attacker
 * spreading requests gets a multiple of the intended budget, and the
 * cross-visitor attack log empties whenever an instance recycles.
 *
 * So: an in-memory backend that needs no setup and is honest about being
 * per-instance, and an Upstash Redis backend over REST that activates
 * automatically when the two env vars are present. REST rather than a TCP
 * client because serverless functions cannot hold a connection pool usefully.
 *
 * `backendName()` is surfaced in /api/usage and in the UI, because a spend cap
 * that silently degrades to per-instance is worse than one labelled as such.
 */

export interface CounterStore {
  /** Increment and return the new value, setting a TTL on first write. */
  increment(key: string, ttlSeconds: number, by?: number): Promise<number>;
  get(key: string): Promise<number>;
  /** Append to a capped list, newest first. */
  push(key: string, value: unknown, cap: number, ttlSeconds: number): Promise<void>;
  list(key: string, limit: number): Promise<unknown[]>;
  backendName(): string;
  durable(): boolean;
}

// --- In-memory -------------------------------------------------------------

interface Entry {
  value: number;
  expiresAt: number;
}

/**
 * Module-scope maps.
 *
 * Survive between invocations on a warm instance, which is most of them, and
 * vanish on a cold start. Swept lazily on access rather than on a timer — a
 * serverless function has no reliable background clock.
 */
const counters = new Map<string, Entry>();
const lists = new Map<string, { values: unknown[]; expiresAt: number }>();

function sweep(now: number) {
  if (counters.size > 5000) {
    for (const [k, v] of counters) if (v.expiresAt <= now) counters.delete(k);
  }
  if (lists.size > 200) {
    for (const [k, v] of lists) if (v.expiresAt <= now) lists.delete(k);
  }
}

class MemoryStore implements CounterStore {
  async increment(key: string, ttlSeconds: number, by = 1): Promise<number> {
    const now = Date.now();
    sweep(now);
    const existing = counters.get(key);
    if (!existing || existing.expiresAt <= now) {
      counters.set(key, { value: by, expiresAt: now + ttlSeconds * 1000 });
      return by;
    }
    existing.value += by;
    return existing.value;
  }

  async get(key: string): Promise<number> {
    const entry = counters.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return 0;
    return entry.value;
  }

  async push(key: string, value: unknown, cap: number, ttlSeconds: number): Promise<void> {
    const now = Date.now();
    const existing = lists.get(key);
    if (!existing || existing.expiresAt <= now) {
      lists.set(key, { values: [value], expiresAt: now + ttlSeconds * 1000 });
      return;
    }
    existing.values.unshift(value);
    if (existing.values.length > cap) existing.values.length = cap;
  }

  async list(key: string, limit: number): Promise<unknown[]> {
    const entry = lists.get(key);
    if (!entry || entry.expiresAt <= Date.now()) return [];
    return entry.values.slice(0, limit);
  }

  backendName() {
    return 'in-memory (per-instance)';
  }

  durable() {
    return false;
  }
}

// --- Upstash Redis over REST ----------------------------------------------

class UpstashStore implements CounterStore {
  constructor(
    private url: string,
    private token: string,
  ) {}

  /** Pipelined command execution. Returns each command's result in order. */
  private async pipeline(commands: unknown[][]): Promise<unknown[]> {
    const res = await fetch(`${this.url}/pipeline`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(commands),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    return json.map((r) => {
      if (r.error) throw new Error(`Upstash command failed: ${r.error}`);
      return r.result;
    });
  }

  async increment(key: string, ttlSeconds: number, by = 1): Promise<number> {
    // INCRBY then NX-guarded EXPIRE, so the window is set once on creation
    // rather than sliding forward on every hit — a sliding window would let a
    // steady stream of requests keep a counter alive indefinitely.
    const [value] = await this.pipeline([
      ['INCRBY', key, String(by)],
      ['EXPIRE', key, String(ttlSeconds), 'NX'],
    ]);
    return Number(value) || 0;
  }

  async get(key: string): Promise<number> {
    const [value] = await this.pipeline([['GET', key]]);
    return Number(value) || 0;
  }

  async push(key: string, value: unknown, cap: number, ttlSeconds: number): Promise<void> {
    await this.pipeline([
      ['LPUSH', key, JSON.stringify(value)],
      ['LTRIM', key, '0', String(cap - 1)],
      ['EXPIRE', key, String(ttlSeconds)],
    ]);
  }

  async list(key: string, limit: number): Promise<unknown[]> {
    const [values] = await this.pipeline([['LRANGE', key, '0', String(limit - 1)]]);
    if (!Array.isArray(values)) return [];
    return values.map((v) => {
      try {
        return JSON.parse(String(v));
      } catch {
        return v;
      }
    });
  }

  backendName() {
    return 'upstash redis (durable)';
  }

  durable() {
    return true;
  }
}

// --- Selection -------------------------------------------------------------

let instance: CounterStore | null = null;

export function store(): CounterStore {
  if (instance) return instance;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  instance = url && token ? new UpstashStore(url.replace(/\/$/, ''), token) : new MemoryStore();
  return instance;
}

/**
 * Run a store operation, falling back to a default if the backend is down.
 *
 * A Redis outage must not take the hotline down, but it must also not silently
 * disable the limits. Callers decide which way to fail: rate limits fail open
 * (a visitor gets through), the spend cap fails closed (requests are refused).
 */
export async function safely<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op();
  } catch {
    return fallback;
  }
}
