"use client";

import { useTransition } from "react";
import { setOutreachStatus } from "@/app/actions";
import { STATUS_LABELS } from "./ui";

export default function StatusSelect({ companyId, value }) {
  const [pending, startTransition] = useTransition();
  return (
    <select
      className="select"
      aria-label="Outreach status"
      defaultValue={value}
      disabled={pending}
      onChange={(e) => {
        const status = e.target.value;
        startTransition(async () => {
          await setOutreachStatus(companyId, status);
        });
      }}
    >
      {Object.entries(STATUS_LABELS).map(([k, label]) => (
        <option key={k} value={k}>{label}</option>
      ))}
    </select>
  );
}
