import { cx } from "@/components/ui";

/** Ảnh đại diện tròn; chưa có ảnh thì hiện chữ cái đầu của tên */
export function Avatar({ name, src, size = 32, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const initial = name.trim().split(/\s+/).pop()?.[0]?.toUpperCase() ?? "?";
  const style = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- data URL nhỏ, không qua tối ưu ảnh
    return <img src={src} alt="" width={size} height={size} style={style} className={cx("shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span aria-hidden style={{ ...style, fontSize: Math.round(size * 0.42) }}
      className={cx("flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand", className)}>
      {initial}
    </span>
  );
}
