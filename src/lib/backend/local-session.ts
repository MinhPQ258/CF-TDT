// Cookie phiên cho chế độ local: "<userId>.<hmac>". Web Crypto → dùng được cả trong middleware (edge).

export const LOCAL_SESSION_COOKIE = "ctdt_local_session";

function secret(): string {
  return process.env.LOCAL_SESSION_SECRET || "coffee-tdt-local-dev-only-secret";
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signSession(userId: string): Promise<string> {
  return `${userId}.${await hmac(userId)}`;
}

/** Trả userId nếu cookie hợp lệ, ngược lại null */
export async function verifySession(cookie: string | undefined | null): Promise<string | null> {
  if (!cookie) return null;
  const i = cookie.lastIndexOf(".");
  if (i <= 0) return null;
  const id = cookie.slice(0, i);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = await hmac(id);
  const got = cookie.slice(i + 1);
  if (got.length !== expected.length) return null;
  let diff = 0;
  for (let k = 0; k < got.length; k++) diff |= got.charCodeAt(k) ^ expected.charCodeAt(k);
  return diff === 0 ? id : null;
}
