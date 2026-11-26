const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

// ---------------------------------------------------------------------------
// Circular breadcrumb buffer for production crash reporting.
// ---------------------------------------------------------------------------

const MAX_BREADCRUMBS = 50;

interface Breadcrumb {
  level: 'info' | 'warn' | 'error' | 'sync';
  msg: string;
  ts: number;
  data?: object;
}

const breadcrumbs: Breadcrumb[] = [];
let breadcrumbHead = 0;

function pushBreadcrumb(level: Breadcrumb['level'], msg: string, data?: object) {
  const entry: Breadcrumb = { level, msg, ts: Date.now(), data: data ? sanitize(data) : undefined };
  if (breadcrumbs.length < MAX_BREADCRUMBS) {
    breadcrumbs.push(entry);
  } else {
    breadcrumbs[breadcrumbHead] = entry;
  }
  breadcrumbHead = (breadcrumbHead + 1) % MAX_BREADCRUMBS;
}

// ---------------------------------------------------------------------------
// Sensitive data sanitization.
// A future crash reporter MUST call sanitize() before transmitting any
// context. Fields that could leak book content, file paths, annotations,
// or auth tokens are redacted.
// ---------------------------------------------------------------------------

/** Patterns whose values must be replaced with '[redacted]'. */
const SENSITIVE_KEYS =
  /^(local_uri|text_dir|cover_uri|storage_path|uri|path|filePath|token|access_token|refresh_token|session|password|secret|note|annotation|text|content|snippet|body|passage)$/i;

/** Redact an object in-place (shallow copy first so the original is untouched). */
export function sanitize<T>(obj: T): T {
  if (obj == null || typeof obj !== 'object') return obj;
  if (obj instanceof Error) {
    return { name: obj.name, message: obj.message, stack: obj.stack } as unknown as T;
  }
  const clone = (Array.isArray(obj) ? [...obj] : { ...obj }) as Record<string, unknown>;
  for (const key of Object.keys(clone)) {
    if (SENSITIVE_KEYS.test(key)) {
      clone[key] = '[redacted]';
    } else if (typeof clone[key] === 'string' && (clone[key] as string).length > 500) {
      clone[key] = (clone[key] as string).slice(0, 80) + '…[truncated]';
    } else if (clone[key] != null && typeof clone[key] === 'object') {
      clone[key] = sanitize(clone[key]);
    }
  }
  return clone as unknown as T;
}

// ---------------------------------------------------------------------------
// Public logger API
// ---------------------------------------------------------------------------

export const logger = {
  info(msg: string, data?: object): void {
    pushBreadcrumb('info', msg, data);
    if (IS_DEV) {
      if (data !== undefined) {
        console.log(`[info] ${msg}`, data);
      } else {
        console.log(`[info] ${msg}`);
      }
    }
  },

  warn(msg: string, data?: object): void {
    pushBreadcrumb('warn', msg, data);
    if (IS_DEV) {
      if (data !== undefined) {
        console.warn(`[warn] ${msg}`, data);
      } else {
        console.warn(`[warn] ${msg}`);
      }
    }
  },

  error(msg: string, error?: unknown, data?: object): void {
    const errorObj = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error != null
        ? { value: String(error) }
        : undefined;
    pushBreadcrumb('error', msg, { ...errorObj, ...data });
    if (IS_DEV) {
      if (data !== undefined) {
        console.error(`[error] ${msg}`, error, data);
      } else {
        console.error(`[error] ${msg}`, error);
      }
    }
  },

  sync(msg: string, data?: object): void {
    pushBreadcrumb('sync', msg, data);
    if (IS_DEV) {
      if (data !== undefined) {
        console.log(`[sync] ${msg}`, data);
      } else {
        console.log(`[sync] ${msg}`);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Breadcrumb access for a future crash reporter.
// Returns breadcrumbs oldest-first with all sensitive fields already redacted.
// ---------------------------------------------------------------------------

export function getCrashBreadcrumbs(): Breadcrumb[] {
  if (breadcrumbs.length < MAX_BREADCRUMBS) return [...breadcrumbs];
  return [
    ...breadcrumbs.slice(breadcrumbHead),
    ...breadcrumbs.slice(0, breadcrumbHead),
  ];
}
