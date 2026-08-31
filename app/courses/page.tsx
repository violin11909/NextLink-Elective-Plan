import type { Metadata } from "next";
import { AvailabilityEditor } from "@/components/availability-editor";
import { getPlanPayload } from "@/lib/plan-data.ts";

export const metadata: Metadata = { title: "NextLink · วิชาและช่วงที่สะดวก" };

export default function CoursesPage() {
  return <AvailabilityEditor payload={getPlanPayload()} />;
}
