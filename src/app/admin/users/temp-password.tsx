"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/** Hiển thị mật khẩu tạm đúng một lần; không lưu ở đâu khác. */
export function TempPassword({ username, password }: { username: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-warn/30 bg-warn-soft p-3" role="status">
      <p className="text-sm">Tài khoản <strong>{username}</strong> đăng nhập bằng mật khẩu:</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded bg-surface px-2 py-1 font-mono text-lg tracking-wider select-all">{password}</code>
        <Button type="button" variant="secondary" onClick={async () => {
          try {
            await navigator.clipboard.writeText(password);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}>{copied ? "Đã sao chép" : "Sao chép"}</Button>
      </div>
    </div>
  );
}
