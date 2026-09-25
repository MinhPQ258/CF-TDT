import { NextResponse, type NextRequest } from "next/server";
import { currentAdmin } from "@/lib/auth";
import { callRpc } from "@/lib/rpc";
import { isIsoDate } from "@/lib/dates";
import { buildExport, type ExportData } from "@/lib/excel/export";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Xuất Excel 6 sheet theo kỳ [from, to]. Giới hạn 12 tháng / 20.000 dòng (kiểm ở DB). */
export async function GET(req: NextRequest) {
  if (!(await currentAdmin())) return NextResponse.json({ code: "INSUFFICIENT_PERMISSION" }, { status: 403 });
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!isIsoDate(from) || !isIsoDate(to)) return NextResponse.json({ code: "INVALID_INPUT", message: "Kỳ không hợp lệ" }, { status: 400 });
  const r = await callRpc<ExportData>("admin_export_data", { p_from: from, p_to: to });
  if (!r.ok) return NextResponse.json({ code: r.error.code, message: r.error.message }, { status: r.error.code === "INVALID_INPUT" ? 400 : 500 });
  const buf = await buildExport(r.data);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="coffee-tdt_${from}_${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
