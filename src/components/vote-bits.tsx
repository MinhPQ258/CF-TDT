import { Badge } from "@/components/ui";
import { VOTE_STATE_LABEL } from "@/lib/labels";
import { formatDate, formatTime } from "@/lib/dates";
import type { VoteSession, VoteState } from "@/lib/types";

const TONE: Record<VoteState, "ok" | "neutral" | "warn" | "danger" | "brand"> = {
  OPEN: "ok", UPCOMING: "brand", CLOSED: "neutral", CANCELLED: "danger", DRAFT: "warn",
};

export function VoteStateBadge({ state }: { state: VoteState }) {
  return <Badge tone={TONE[state]}>{VOTE_STATE_LABEL[state]}</Badge>;
}

export function VoteWhen({ s }: { s: VoteSession }) {
  return (
    <span>
      {formatDate(s.service_date)} · mở {formatTime(s.opens_at)} · chốt {formatTime(s.closed_at)}
      {s.planned_brew_at && <> · pha {formatTime(s.planned_brew_at)}</>}
    </span>
  );
}
