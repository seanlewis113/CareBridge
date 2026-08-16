import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderCaregiverShell } from '../shared/shell';
import { el } from '../../shared/utils';
import { icon } from '../../shared/icons';
import { ensureTaskRealtime } from '../../shared/realtime';
import { taskHasAssignees } from '../../shared/taskAssignments';
import {
  DEFAULT_CAREGIVER_TASK_LIST_STATE,
  filterCaregiverTasks,
  sortCaregiverTasks,
  statusesMatchCaregiverDefault,
  renderCaregiverTaskToolbar,
  renderCaregiverTaskListSection,
  type CaregiverTaskListState,
} from './taskTable';

export async function renderCaregiverTasks(): Promise<void> {
  let myTasksState: CaregiverTaskListState = {
    ...DEFAULT_CAREGIVER_TASK_LIST_STATE,
    statuses: new Set(DEFAULT_CAREGIVER_TASK_LIST_STATE.statuses),
  };

  const content = el('div', {});

  const render = async () => {
    const session = getSession();
    const profileId = session.profile?.id;

    const [tasks, assignments] = await Promise.all([
      api.getTasks(),
      api.getTaskAssignments(),
    ]);

    const myTaskIds = new Set(
      assignments.filter((a) => a.profile_id === profileId).map((a) => a.task_id)
    );

    const assignedTasks = tasks.filter((t) => myTaskIds.has(t.id));
    const availableTasks = tasks.filter(
      (t) => t.open_slot && !taskHasAssignees(t.id, assignments) && t.status !== 'completed'
    );

    const filteredMy = filterCaregiverTasks(assignedTasks, myTasksState);
    const sortedMy = sortCaregiverTasks(filteredMy, myTasksState);
    const myHasActiveFilters =
      myTasksState.search.trim() !== '' || !statusesMatchCaregiverDefault(myTasksState.statuses);

    const myListSection = renderCaregiverTaskListSection(
      sortedMy,
      assignedTasks,
      myTasksState,
      (patch) => {
        myTasksState = { ...myTasksState, ...patch };
        void render();
      },
      {
        profileId,
        refresh: () => render(),
      }
    );

    const availableSection = renderCaregiverTaskListSection(
      availableTasks,
      availableTasks,
      {
        search: '',
        statuses: new Set(['pending', 'in_progress', 'completed'] as const),
        sortKey: 'due',
        sortDir: 'asc',
      },
      () => {},
      {
        profileId,
        refresh: () => render(),
        showClaim: true,
        isUnassigned: true,
      },
      'No unclaimed tasks right now.',
      'No unclaimed tasks right now.'
    );

    content.replaceChildren(
      el('div', { className: 'admin-task-page-header' },
        el('h2', {}, 'My Tasks')
      ),
      renderCaregiverTaskToolbar(myTasksState, myHasActiveFilters, (patch) => {
        myTasksState = { ...myTasksState, ...patch };
        void render();
      }),
      myListSection,
      el('h2', { className: 'section-title' }, icon('users'), 'Available to Claim'),
      availableSection
    );
  };

  await render();
  renderCaregiverShell(content, '/caregiver/tasks');

  ensureTaskRealtime(() => {
    void render();
  });
}
