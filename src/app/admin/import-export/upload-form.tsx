"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { stageImportAction, type StageResult } from "@/features/excel/actions";
import type { ActionState } from "@/lib/action";
import { IMPORT_KIND_LABEL } from "@/lib/labels";
import { Field, Input, Select } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/form";

export function UploadForm() {
  const [state, action] = useActionState<ActionState<StageResult>, FormData>(stageImportAction, {});
  const router = useRouter();
  useEffect(() => {
    if (state.data?.job_id) router.push(`/admin/import-export?job=${state.data.job_id}`);
  }, [state, router]);

  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} loginNext="/admin/import-export" />
      {state.data?.structure_errors && (
        <ul className="list-disc rounded-lg bg-danger-soft p-3 pl-7 text-sm">{state.data.structure_errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      <Field label="Loại dữ liệu" htmlFor="kind" error={state.fieldErrors?.kind} required>
        <Select id="kind" name="kind" defaultValue="DEPOSITS">
          {Object.entries(IMPORT_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <Field label="File .xlsx (tối đa 2 MB, 5.000 dòng)" htmlFor="file" error={state.fieldErrors?.file} required>
        <Input id="file" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
      </Field>
      <SubmitButton className="w-full" pendingText="Đang đọc file…">Tải lên & kiểm tra</SubmitButton>
    </form>
  );
}
