import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderCaregiverShell } from '../shared/shell';
import { navigate } from '../../shared/router';
import { el, formatDate, formatTime, emptyState } from '../../shared/utils';
import { icon } from '../../shared/icons';

export async function renderCaregiverToday(): Promise<void> {
  const session = getSession();
  const profileId = session.profile?.id;

  const [events, tasks, assignments] = await Promise.all([
    api.getUpcomingEvents(3),
    api.getTasks(),
    api.getTaskAssignments(),
  ]);

  const myTaskIds = new Set(
    assignments.filter((a) => a.profile_id === profileId).map((a) => a.task_id)
  );
  const myTasks = tasks.filter(
    (t) => myTaskIds.has(t.id) || (t.open_slot && !t.claimed_by) || t.claimed_by === profileId
  ).filter((t) => t.status !== 'completed');

  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = events.filter((e) => e.start_at.startsWith(today));

  const content = el('div', {});

  const logVisitBtn = el('button', { className: 'btn btn-primary btn-lg', type: 'button' },
    icon('pen-line'),
    'Log Visit Notes'
  );
  logVisitBtn.addEventListener('click', () => navigate('/caregiver/visit'));
  content.append(el('div', { className: 'caregiver-cta' }, logVisitBtn));

  content.append(el('h2', { className: 'section-title' }, icon('calendar'), 'Today\'s Schedule'));
  if (todayEvents.length === 0) {
    content.append(emptyState(
      icon('sun'),
      'Free day',
      'No events scheduled for today.'
    ));
  } else {
    const card = el('div', { className: 'card' });
    const timeline = el('div', { className: 'timeline' });
    for (const event of todayEvents) {
      timeline.append(
        el('div', { className: 'timeline-item' },
          el('div', { className: 'timeline-time' }, formatTime(event.start_at)),
          el('div', { className: 'timeline-title' }, event.title)
        )
      );
    }
    card.append(timeline);
    content.append(card);
  }

  content.append(el('h2', { className: 'section-title' }, icon('clipboard-list'), 'My Tasks'));
  if (myTasks.length === 0) {
    content.append(emptyState(
      icon('check-circle'),
      'All caught up',
      'No tasks assigned. Check back later.'
    ));
  } else {
    for (const task of myTasks) {
      content.append(renderCaregiverTaskCard(task, profileId, () => renderCaregiverToday()));
    }
  }

  renderCaregiverShell(content, '/caregiver');
}

function renderCaregiverTaskCard(
  task: import('../../shared/types').Task,
  profileId: string | undefined,
  refresh: () => void
): HTMLElement {
  const card = el('div', { className: 'card task-card' },
    el('strong', {}, task.title),
    task.description ? el('p', {}, task.description) : null,
    task.due_at ? el('p', { style: 'font-size:0.85rem;color:var(--color-text-muted)' }, `Due: ${formatDate(task.due_at)}`) : null,
    task.open_slot && !task.claimed_by
      ? el('button', { className: 'btn btn-secondary', type: 'button', style: 'margin-top:0.5rem' }, 'Claim this task')
      : null,
    el('button', { className: 'btn btn-primary', type: 'button', style: 'margin-top:0.5rem' }, 'Mark Complete')
  );

  card.querySelector('.btn-secondary')?.addEventListener('click', async () => {
    if (!profileId) return;
    try {
      await api.claimTask(task.id, profileId);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unable to claim task');
    }
  });

  card.querySelector('.btn-primary')?.addEventListener('click', async () => {
    await api.updateTask(task.id, { status: 'completed' });
    await refresh();
  });

  return card;
}
