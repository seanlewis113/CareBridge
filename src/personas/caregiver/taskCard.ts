import { api } from '../../shared/api';
import { el, formatDate } from '../../shared/utils';
import type { Task } from '../../shared/types';

export interface CaregiverTaskCardOptions {
  profileId?: string;
  refresh: () => void | Promise<void>;
  showClaim?: boolean;
  isUnassigned?: boolean;
  showStatus?: boolean;
  showChecklist?: boolean;
}

export function renderCaregiverTaskCard(
  task: Task,
  options: CaregiverTaskCardOptions
): HTMLElement {
  const {
    profileId,
    refresh,
    showClaim = false,
    isUnassigned = false,
    showStatus = false,
    showChecklist = false,
  } = options;
  const headerChildren: HTMLElement[] = [
    el('h3', { className: 'caregiver-task-card-title' }, task.title),
  ];

  if (showStatus) {
    headerChildren.push(
      el(
        'span',
        { className: `badge badge-${task.status === 'completed' ? 'completed' : 'pending'}` },
        task.status === 'completed' ? 'Done' : 'To do'
      )
    );
  }

  const header = el('div', { className: 'caregiver-task-card-header' }, ...headerChildren);

  const body = el('div', { className: 'caregiver-task-card-body' });

  if (task.description) {
    body.append(el('p', { className: 'caregiver-task-card-desc' }, task.description));
  }

  if (task.due_at) {
    body.append(
      el('p', { className: 'caregiver-task-card-due' }, `Due ${formatDate(task.due_at)}`)
    );
  }

  const card = el('div', { className: 'card task-card caregiver-task-card' }, header, body);

  if (showChecklist && task.checklist.length > 0) {
    const checklist = el('div', { className: 'caregiver-task-checklist' });
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

  const actions = el('div', { className: 'task-actions caregiver-task-actions' });

  if (showClaim && task.open_slot && isUnassigned) {
    const claimBtn = el('button', { className: 'btn btn-secondary', type: 'button' }, 'Claim task');
    claimBtn.addEventListener('click', async () => {
      if (!profileId) return;
      try {
        await api.claimTask(task.id, profileId);
        await refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Unable to claim task');
      }
    });
    actions.append(claimBtn);
  }

  if (task.status !== 'completed' && !(showClaim && task.open_slot && isUnassigned)) {
    const completeBtn = el(
      'button',
      { className: 'btn btn-primary', type: 'button' },
      'Mark complete'
    );
    completeBtn.addEventListener('click', async () => {
      await api.updateTask(task.id, { status: 'completed' });
      await refresh();
    });
    actions.append(completeBtn);
  }

  if (actions.childElementCount > 0) {
    card.append(actions);
  }

  return card;
}
