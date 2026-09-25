import "server-only";

// Log JSON có cấu trúc: request_id, user_id, action, code, params. Không bao giờ log mật khẩu.

const SECRET_KEYS = /pass(word)?|token|secret|key$/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.length > 20 ? `[${value.length} items]` : value.map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) && k !== "idempotency_key" && k !== "p_idem_key" ? "[redacted]" : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

type Level = "info" | "warn" | "error";

export interface LogFields {
  request_id?: string | null;
  user_id?: string | null;
  action: string;
  code?: string;
  params?: unknown;
  detail?: string;
  duration_ms?: number;
}

export function log(level: Level, fields: LogFields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...fields, params: scrub(fields.params) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
