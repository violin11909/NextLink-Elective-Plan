import { PlanOverview } from "@/components/plan-overview";
import { getPlanPayload } from "@/lib/plan-data.ts";

export default function PlanPage() {
  return <PlanOverview payload={getPlanPayload()} />;
}
