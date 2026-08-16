import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderCaregiverShell } from '../shared/shell';
import { navigate } from '../../shared/router';
import { el, formatTime, emptyState } from '../../shared/utils';
import { icon } from '../../shared/icons';
import { ensureTaskRealtime } from '../../shared/realtime';
import { taskHasAssignees } from '../../shared/taskAssignments';
import { renderCaregiverTaskCard } from './taskCard';import { renderRecurringChecksSection } from './recurringChecks';

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
  const assignedTasks = tasks.filter(
    (t) => myTaskIds.has(t.id) && t.status !== 'completed'
  );
  const availableTasks = tasks.filter(
    (t) => t.open_slot && !taskHasAssignees(t.id, assignments) && t.status !== 'completed'
  );
  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = events.filter((e) => e.start_at.startsWith(today));

  const content = el('div', {});

  const logVisitBtn = el('button', { className: 'btn btn-primary btn-lg', type: 'button' },
    icon('pen-line'),
    'Log Visit Notes'
  );
  logVisitBtn.addEventListener('click', () => navigate('/caregiver/visit'));
  content.append(el('div', { className: 'caregiver-cta' }, logVisitBtn));

  content.append(await renderRecurringChecksSection(() => renderCaregiverToday()));

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
  if (assignedTasks.length === 0) {
    content.append(emptyState(
      icon('check-circle'),
      'All caught up',
      'No tasks assigned. Check back later.'
    ));
  } else {
    const taskList = el('div', { className: 'caregiver-task-list' });
    for (const task of assignedTasks) {
      taskList.append(
        renderCaregiverTaskCard(task, {
          profileId,
          refresh: () => renderCaregiverToday(),
        })
      );
    }
    content.append(taskList);
  }

  content.append(el('h2', { className: 'section-title' }, icon('users'), 'Available to Claim'));
  if (availableTasks.length === 0) {
    content.append(emptyState(
      icon('check-circle'),
      'Nothing open',
      'No unclaimed tasks right now.'
    ));
  } else {
    const taskList = el('div', { className: 'caregiver-task-list' });
    for (const task of availableTasks) {
      taskList.append(
        renderCaregiverTaskCard(task, {
          profileId,
          refresh: () => renderCaregiverToday(),
          showClaim: true,
          isUnassigned: !taskHasAssignees(task.id, assignments),
        })      );
    }
    content.append(taskList);
  }

  renderCaregiverShell(content, '/caregiver');
  ensureTaskRealtime(() => {
    void renderCaregiverToday();
  });
}

