import type { Metadata } from "next";
import { CourseList } from "@/components/course-list";
import { getArchivedTerms, getPlanPayload, getTermIndex } from "@/lib/plan-data.ts";

export const metadata: Metadata = { title: "NextLink · รายวิชา" };

export default function CourseListPage() {
  // Every term is read here and handed down together: there are a handful of
  // them, they are bundled with the app either way, and switching terms is
  // then a state change in the table rather than a page load.
  return <CourseList payload={getPlanPayload()} terms={getTermIndex()} archives={getArchivedTerms()} />;
}
