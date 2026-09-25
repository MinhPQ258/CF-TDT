"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Alert, Button, cx } from "@/components/ui";
import type { ActionState } from "@/lib/action";

export function SubmitButton({ children, pendingText = "Đang gửi…", variant = "primary", className, disabled }: {
  children: ReactNode; pendingText?: string; variant?: "primary" | "secondary" | "danger"; className?: string; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending || disabled} aria-busy={pending} className={className}>
      {pending ? pendingText : children}
    </Button>
  );
}

/** Thông báo tổng cho form (lỗi/thành công). SESSION_EXPIRED kèm link đăng nhập lại. */
export function FormMessage({ state, loginNext }: { state: ActionState; loginNext?: string }) {
  if (!state.message || state.ok === undefined) return null;
  if (state.ok) return <Alert tone="ok">{state.message}</Alert>;
  return (
    <Alert tone="danger" title={state.message}>
      {state.code === "SESSION_EXPIRED" && (
        <p>
          Dữ liệu bạn đã nhập vẫn được giữ trên trang này.{" "}
          <Link className="underline" href={`/login${loginNext ? `?next=${encodeURIComponent(loginNext)}` : ""}`} target="_blank">
            Đăng nhập lại ở tab mới
          </Link>{" "}
          rồi bấm gửi lại.
        </p>
      )}
      {state.code === "NETWORK" && <p>Bấm gửi lại: hệ thống nhận biết lần gửi trùng và không ghi hai lần.</p>}
    </Alert>
  );
}

/**
 * Idempotency key sinh khi mở form; chỉ đổi sau khi ghi thành công.
 * Double-click / refresh / gửi lại đều dùng cùng key → DB trả event cũ.
 */
export function useIdempotencyKey(state: ActionState) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const lastAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state.at && state.at !== lastAt.current) {
      lastAt.current = state.at;
      if (state.ok) setKey(crypto.randomUUID());
    }
  }, [state]);
  return key;
}

/** Reset form sau khi thành công */
export function useResetOnSuccess(state: ActionState) {
  const ref = useRef<HTMLFormElement>(null);
  const lastAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state.ok && state.at && state.at !== lastAt.current) {
      lastAt.current = state.at;
      ref.current?.reset();
    }
  }, [state]);
  return ref;
}

/** Hộp xác nhận dùng <dialog> gốc (cuộn được bên trong trên màn 667px). */
export function ConfirmDialog({ open, title, children, confirmText, onConfirm, onCancel, danger, busy }: {
  open: boolean; title: string; children: ReactNode; confirmText: string; onConfirm: () => void; onCancel: () => void;
  danger?: boolean; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }}
      className="m-auto max-h-[85dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line bg-surface p-5 text-ink">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 space-y-2">{children}</div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Hủy</Button>
        <Button type="button" variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy} aria-busy={busy}>
          {busy ? "Đang xử lý…" : confirmText}
        </Button>
      </div>
    </dialog>
  );
}

export function FieldError({ state, name }: { state: ActionState; name: string }) {
  const msg = state.fieldErrors?.[name];
  if (!msg) return null;
  return <p id={`${name}-error`} className="text-sm text-danger">{msg}</p>;
}

export function errProps(state: ActionState, name: string) {
  const invalid = Boolean(state.fieldErrors?.[name]);
  return { "aria-invalid": invalid, "aria-describedby": invalid ? `${name}-error` : undefined };
}

export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} aria-hidden />;
}
