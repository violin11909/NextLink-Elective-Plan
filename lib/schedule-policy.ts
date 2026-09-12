import type { BlockerCode, PlanCourse } from "./plan-types.ts";

export type SchedulerOptions = {
  providerIsSingleTeam?: boolean;
  backtrackDepth?: number;
};

export const DEFAULT_SCHEDULER_OPTIONS: Required<SchedulerOptions> = {
  providerIsSingleTeam: true,
  backtrackDepth: 2,
};

/** Shared by candidate selection and the final plan's conflict report. */
export function teachingBlockers(
  course: PlanCourse,
  other: PlanCourse,
  options: SchedulerOptions = DEFAULT_SCHEDULER_OPTIONS,
): BlockerCode[] {
  if (course.instructor === other.instructor) return ["INSTRUCTOR_BUSY"];
  if ((options.providerIsSingleTeam ?? true) && course.provider === other.provider) return ["PROVIDER_BUSY"];
  return [];
}
