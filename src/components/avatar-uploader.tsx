"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMyAvatarAction } from "@/features/profile/actions";
import type { ActionState } from "@/lib/action";
import { Avatar } from "@/components/avatar";
import { FormMessage } from "@/components/form";

const SIZE = 256;

/** Đọc ảnh → cắt vuông giữa → 256×256 JPEG (~15–30KB) để lưu thẳng vào hồ sơ */
async function toAvatarDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Không đọc được ảnh"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh");
    ctx.fillStyle = "#ffffff"; // ảnh PNG trong suốt → nền trắng
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AvatarUploader({ name, avatar }: { name: string; avatar: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(avatar);
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  const save = (value: string | null) => start(async () => {
    const r = await setMyAvatarAction(value);
    setState({ ...r, data: undefined });
    if (r.ok) {
      setCurrent(r.data?.avatar ?? null);
      router.refresh();
    }
  });

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // chọn lại cùng ảnh vẫn kích hoạt
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setState({ ok: false, message: "Chọn một file ảnh", at: Date.now() });
      return;
    }
    try {
      save(await toAvatarDataUrl(file));
    } catch (err) {
      setState({ ok: false, message: (err as Error).message || "Không đọc được ảnh", at: Date.now() });
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => input.current?.click()} disabled={pending} aria-busy={pending}
        aria-label="Đổi ảnh đại diện" className="relative shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-brand">
        <Avatar name={name} src={current} size={64} />
        <span aria-hidden className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border-2 border-surface bg-brand text-brand-ink">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
          </svg>
        </span>
      </button>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap gap-x-3 text-sm">
          <button type="button" onClick={() => input.current?.click()} disabled={pending} className="min-h-9 font-medium text-brand underline">
            {current ? "Đổi ảnh" : "Tải ảnh lên"}
          </button>
          {current && (
            <button type="button" onClick={() => save(null)} disabled={pending} aria-busy={pending} className="min-h-9 text-muted underline">Xoá ảnh</button>
          )}
        </div>
        <FormMessage state={state} />
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={onPick} />
    </div>
  );
}
