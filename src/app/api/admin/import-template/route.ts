import { NextResponse, type NextRequest } from "next/server";
import { currentAdminWith } from "@/lib/auth";
import { buildTemplate } from "@/lib/excel/template";
import { IMPORT_SPECS } from "@/lib/excel/spec";
import type { ImportKind } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await currentAdminWith("excel.manage"))) return NextResponse.json({ code: "INSUFFICIENT_PERMISSION" }, { status: 403 });
  const kind = req.nextUrl.searchParams.get("kind") as ImportKind | null;
  if (!kind || !(kind in IMPORT_SPECS)) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });
  const buf = await buildTemplate(kind);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="mau_${IMPORT_SPECS[kind].sheet}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
