// Safe diagnostics for server-side failures of privileged account operations. Pure: relative imports only, so `npm test` loads it.
//
// A log line must say WHICH step failed and WHY (the SDK's own status, code and message), but must never carry a secret: not a password that was
// sent, not a key, not a token. `sanitizeError` keeps only a Supabase error's name, status, code and message, redacts every known secret value and every
// token-shaped string from the message, and caps its length; `diagnosticLine` turns that into one JSON line with the operation, the step and the
// (non-secret) ids involved. Nothing that is sent TO Supabase (a password, a request body) is ever included.

const MAX_MESSAGE_LENGTH = 300;

// JWTs (access / refresh tokens, anon and service keys), Supabase secret / publishable keys, and Authorization headers.
const TOKEN_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

/**
 * @param {unknown} error - a Supabase / PostgREST / Auth error (or anything thrown).
 * @param {string[]} [secrets] - values that must not appear (the generated password, for one); values shorter than 4 characters are ignored.
 * @returns {{ name: string|null, status: number|null, code: string|null, message: string }}
 */
export function sanitizeError(error, secrets = []) {
  let message = String(error?.message ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) message = message.split(secret).join("[redacted]");
  }
  for (const pattern of TOKEN_PATTERNS) message = message.replace(pattern, "[redacted]");
  if (message.length > MAX_MESSAGE_LENGTH) message = `${message.slice(0, MAX_MESSAGE_LENGTH)}…`;

  return {
    name: typeof error?.name === "string" ? error.name : null,
    status: Number.isInteger(error?.status) ? error.status : null,
    code: typeof error?.code === "string" ? error.code : null,
    message,
  };
}

/**
 * One log line for a step of a privileged operation: `[auth-admin] {"operation":"reset_password","step":"update_user","outcome":"failed",...}`.
 * `context` is for non-secret identifiers only (an instructor id, an auth user id); it is copied, never the error's request data.
 *
 * @param {{ operation: string, step: string, outcome: "ok"|"failed", context?: Record<string, string|number|null>, error?: unknown, secrets?: string[] }} input
 * @returns {string}
 */
export function diagnosticLine({ operation, step, outcome, context = {}, error, secrets = [] }) {
  const entry = { operation, step, outcome, ...context };
  if (error !== undefined) entry.error = sanitizeError(error, secrets);
  return `[auth-admin] ${JSON.stringify(entry)}`;
}
