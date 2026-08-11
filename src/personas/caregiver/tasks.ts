import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderCaregiverShell } from '../shared/shell';
import { el, formatDate } from '../../shared/utils';
import type { Task } from '../../shared/types';

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

  const myTasks = tasks.filter(
    (t) => myTaskIds.has(t.id) || t.claimed_by === profileId
  );

  const content = el('div', {});
  content.append(el('h2', {}, 'My Tasks'));

  if (myTasks.length === 0) {
    content.append(el('p', { className: 'empty-state' }, 'No tasks assigned to you.'));
  } else {
    for (const task of myTasks) {
      content.append(renderTaskCard(task, () => renderCaregiverTasks()));
    }
  }

  renderCaregiverShell(content, '/caregiver/tasks');
}

function renderTaskCard(task: Task, refresh: () => void): HTMLElement {
  const card = el('div', { className: 'card task-card' },
    el('div', { className: 'task-card-header' },
      el('strong', {}, task.title),
      el('span', { className: `badge badge-${task.status === 'completed' ? 'completed' : 'pending'}` }, task.status)
    ),
    task.description ? el('p', {}, task.description) : null,
    task.due_at ? el('p', { style: 'font-size:0.85rem;color:var(--color-text-muted)' }, `Due: ${formatDate(task.due_at)}`) : null
  );

  if (task.checklist.length > 0) {
    const checklist = el('div', { style: 'margin-top:0.5rem' });
    for (const item of task.checklist) {
      const row = el('div', { className: 'checklist-item' });
      const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
      cb.checked = item.done;
      cb.addEventListener('change', async () => {
        const updated = task.checklist.map((c) =>
          c.id === item.id ? { ...c, done: cb.checked } : c
        );
        const allDone = updated.every((c) => c.done);
        await api.updateTask(task.id, {
          checklist: updated,
          status: allDone ? 'completed' : 'in_progress',
        });
        await refresh();
      });
      row.append(cb, item.text);
      checklist.append(row);
    }
    card.append(checklist);
  }

  if (task.status !== 'completed') {
    const completeBtn = el('button', { className: 'btn btn-primary', type: 'button', style: 'margin-top:0.75rem' }, 'Mark Complete');
    completeBtn.addEventListener('click', async () => {
      await api.updateTask(task.id, { status: 'completed' });
      await refresh();
    });
    card.append(completeBtn);
  }

  return card;
}
