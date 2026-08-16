import type { TaskAssignment } from './types';

export function taskHasAssignees(taskId: string, assignments: TaskAssignment[]): boolean {
  return assignments.some((a) => a.task_id === taskId);
}

export function getTaskAssigneeIds(taskId: string, assignments: TaskAssignment[]): string[] {
  return assignments.filter((a) => a.task_id === taskId).map((a) => a.profile_id);
}
