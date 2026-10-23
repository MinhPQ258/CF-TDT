/** Màu các ô vòng quay trực nhật (dùng chung server + client) */
export const DUTY_COLORS = ["#6f4428", "#d9a441", "#3d5a40", "#c97b4a", "#2f4858", "#e8c39e", "#8a5a83", "#9fb69a"];
const LIGHT = new Set(["#d9a441", "#e8c39e", "#9fb69a"]);
export const dutyColor = (i: number) => DUTY_COLORS[((i % DUTY_COLORS.length) + DUTY_COLORS.length) % DUTY_COLORS.length];
/** màu chữ đủ tương phản trên nền ô */
export const dutyInk = (c: string) => (LIGHT.has(c) ? "#1f1a17" : "#ffffff");
