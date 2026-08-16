import { api } from '../../shared/api';
import { getSession } from '../../shared/auth';
import { renderCaregiverShell } from '../shared/shell';
import { el, todayISO } from '../../shared/utils';
import { navigate } from '../../shared/router';
import { ensureTaskRealtime } from '../../shared/realtime';
import { renderRecurringChecksSection } from './recurringChecks';

export async function renderCaregiverVisitForm(): Promise<void> {
  const session = getSession();
  const content = el('div', {});

  content.append(
    el('h2', {}, 'Log Visit'),
    el('p', { style: 'color:var(--color-text-muted);margin-bottom:1rem' },
      'Document what happened during your visit so the family stays informed.'
    ),
    await renderRecurringChecksSection(() => renderCaregiverVisitForm())
  );

  const form = el('form', { className: 'card' });

  form.append(
    field('Visit date', 'date', 'visit-date', todayISO(), true),
    field('Mood / demeanor', 'text', 'visit-mood', '', false, 'Calm, cheerful, confused, tired...'),
    field('Meals', 'text', 'visit-meals', '', false, 'What did she eat? Appetite?'),
    field('Medications given', 'text', 'visit-meds', '', false, 'List any meds administered'),
    field('Activities', 'text', 'visit-activities', '', false, 'Walk, puzzles, TV, visitors...'),
    field('Concerns', 'text', 'visit-concerns', '', false, 'Anything the family should know'),
    field('Additional notes', 'textarea', 'visit-notes', '', false, 'Free-form observations'),
    el('p', { id: 'visit-error', style: 'color:var(--color-danger);display:none' }),
    el('button', { className: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Save Visit Notes')
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!session.profile?.id) {
      const err = form.querySelector('#visit-error') as HTMLElement;
      err.textContent = 'You must be signed in to log a visit.';
      err.style.display = 'block';
      return;
    }

    try {
      await api.createVisitNote({
        author_id: session.profile.id,
        visit_date: val('visit-date') + 'T12:00:00',
        mood: val('visit-mood') || null,
        meals: val('visit-meals') || null,
        meds: val('visit-meds') || null,
        activities: val('visit-activities') || null,
        concerns: val('visit-concerns') || null,
        notes: val('visit-notes') || null,
      });
      navigate('/caregiver/notes');
    } catch (err) {
      const errorEl = form.querySelector('#visit-error') as HTMLElement;
      errorEl.textContent = err instanceof Error ? err.message : 'Could not save';
      errorEl.style.display = 'block';
    }
  });

  content.append(form);
  renderCaregiverShell(content, '/caregiver/visit');
  ensureTaskRealtime(() => {
    void renderCaregiverVisitForm();
  });
}

function field(
  label: string,
  type: string,
  id: string,
  value: string,
  required: boolean,
  placeholder?: string
): HTMLElement {
  const group = el('div', { className: 'form-group' }, el('label', { for: id }, label));
  if (type === 'textarea') {
    const ta = el('textarea', { id, placeholder }) as HTMLTextAreaElement;
    ta.value = value;
    if (required) ta.required = true;
    group.append(ta);
  } else {
    group.append(el('input', { type, id, value, placeholder, required: required ? 'true' : undefined }));
  }
  return group;
}

function val(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement)?.value ?? '';
}
