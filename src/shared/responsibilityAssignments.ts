import type { ResponsibilityAssignment } from './types';

export function getAreaAssigneeIds(areaId: string, assignments: ResponsibilityAssignment[]): string[] {
  return assignments.filter((a) => a.area_id === areaId).map((a) => a.profile_id);
}
