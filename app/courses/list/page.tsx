import type { Metadata } from "next";
import { CourseList } from "@/components/course-list";
import { getPlanPayload } from "@/lib/plan-data.ts";

export const metadata: Metadata = { title: "NextLink · รายวิชา" };

export default function CourseListPage() {
  return <CourseList payload={getPlanPayload()} />;
}
