import { api } from '../../shared/api';

import { getSession } from '../../shared/auth';

import { renderCaregiverShell } from '../shared/shell';

import { el } from '../../shared/utils';

import { icon } from '../../shared/icons';

import { ensureTaskRealtime } from '../../shared/realtime';
import { taskHasAssignees } from '../../shared/taskAssignments';

import { renderCaregiverTaskCard } from './taskCard';


export async function renderCaregiverTasks(): Promise<void> {

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
  const content = el('div', {});

  content.append(el('h2', { className: 'section-title' }, icon('clipboard-list'), 'My Tasks'));

  if (assignedTasks.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No tasks assigned to you.'));
  } else {
    const taskList = el('div', { className: 'caregiver-task-list' });
    for (const task of assignedTasks) {
      taskList.append(
        renderCaregiverTaskCard(task, {
          profileId,
          refresh: () => renderCaregiverTasks(),
          showStatus: true,
          showChecklist: true,
        })
      );
    }
    content.append(taskList);
  }

  content.append(el('h2', { className: 'section-title' }, icon('users'), 'Available to Claim'));

  if (availableTasks.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No unclaimed tasks right now.'));
  } else {
    const taskList = el('div', { className: 'caregiver-task-list' });
    for (const task of availableTasks) {
      taskList.append(
        renderCaregiverTaskCard(task, {
          profileId,
          refresh: () => renderCaregiverTasks(),
          showClaim: true,
          isUnassigned: !taskHasAssignees(task.id, assignments),
          showStatus: true,
        })      );
    }
    content.append(taskList);
  }



  renderCaregiverShell(content, '/caregiver/tasks');

  ensureTaskRealtime(() => {

    void renderCaregiverTasks();

  });

}

