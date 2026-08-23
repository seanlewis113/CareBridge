import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const SYNC_DAYS = 90;
const MS_PER_DAY = 86400000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, code, redirect_uri, event } = await req.json();

    if (action === 'oauth' && code) {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri,
          grant_type: 'authorization_code',
        }),
      });
      const tokens = await tokenRes.json();
      if (!tokens.refresh_token) {
        return json({ error: 'No refresh token received' }, 400);
      }
      await supabase
        .from('app_settings')
        .update({ google_refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() })
        .eq('id', 'default');
      return json({ success: true });
    }

    const { data: settings } = await supabase.from('app_settings').select('*').eq('id', 'default').single();
    if (!settings?.google_refresh_token) {
      return json({ error: 'Google Calendar not connected' }, 400);
    }

    const accessToken = await getAccessToken(settings.google_refresh_token);

    if (action === 'pull') {
      const cronSecret = req.headers.get('x-cron-secret');
      const isCron = !!CRON_SECRET && cronSecret === CRON_SECRET;
      if (CRON_SECRET && !isCron && !req.headers.get('authorization')) {
        return json({ error: 'Unauthorized' }, 401);
      }

      const calendarId = settings.google_calendar_id ?? 'primary';
      const now = new Date();
      const syncEnd = new Date(now.getTime() + SYNC_DAYS * MS_PER_DAY);
      const syncStartIso = now.toISOString();
      const syncEndIso = syncEnd.toISOString();

      const googleItems = await fetchGoogleCalendarEvents(
        accessToken,
        calendarId,
        syncStartIso,
        syncEndIso
      );

      const syncedAt = new Date().toISOString();
      const events = googleItems
        .filter((item) => item.status !== 'cancelled')
        .map((item: GoogleEvent) => ({
          google_event_id: item.id,
          title: item.summary ?? 'Event',
          start_at: item.start?.dateTime ?? item.start?.date,
          end_at: item.end?.dateTime ?? item.end?.date,
          description: item.description ?? null,
          synced_at: syncedAt,
        }));

      const { data: existingRows } = await supabase
        .from('calendar_events')
        .select('id, google_event_id, title, start_at, end_at, description')
        .not('google_event_id', 'is', null)
        .gte('start_at', syncStartIso)
        .lte('start_at', syncEndIso);

      const existingByGoogleId = new Map(
        (existingRows ?? [])
          .filter((row) => row.google_event_id)
          .map((row) => [row.google_event_id as string, row as SyncEventRow])
      );

      const added: SyncChangeItem[] = [];
      const updated: SyncUpdatedItem[] = [];

      for (const ev of events) {
        const existing = existingByGoogleId.get(ev.google_event_id);
        if (!existing) {
          added.push(toChangeItem(ev));
        } else {
          const changedFields = getChangedFields(existing, ev);
          if (changedFields.length > 0) {
            updated.push({
              ...toChangeItem(ev),
              previous: {
                title: existing.title,
                start_at: existing.start_at,
                end_at: existing.end_at,
              },
              changed_fields: changedFields,
            });
          }
        }
        await supabase.from('calendar_events').upsert(ev, { onConflict: 'google_event_id' });
      }

      const googleEventIds = new Set(events.map((ev) => ev.google_event_id));
      const staleRows = (existingRows ?? []).filter(
        (row) => row.google_event_id && !googleEventIds.has(row.google_event_id)
      );
      const staleIds = staleRows.map((row) => row.id);
      const removed = staleRows.map((row) => toChangeItem(row as SyncEventRow));

      if (staleIds.length > 0) {
        await supabase.from('calendar_events').delete().in('id', staleIds);
      }

      const { data } = await supabase.from('calendar_events').select('*').gte('start_at', syncStartIso);
      return json({ events: data ?? [], changes: { added, updated, removed } });
    }

    if (action === 'push' && event) {
      const calendarId = settings.google_calendar_id ?? 'primary';
      const allDay = isAllDayCalendarEvent(event);
      const body = allDay
        ? {
            summary: event.title,
            description: event.description,
            start: { date: event.start_at.slice(0, 10) },
            end: { date: event.end_at.slice(0, 10) },
          }
        : {
            summary: event.title,
            description: event.description,
            start: { dateTime: event.start_at, timeZone: 'America/Los_Angeles' },
            end: { dateTime: event.end_at, timeZone: 'America/Los_Angeles' },
          };
      const calRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const created = await calRes.json();
      if (!calRes.ok) {
        return json({ error: created.error?.message ?? 'Failed to create Google Calendar event' }, 400);
      }
      await supabase
        .from('calendar_events')
        .update({ google_event_id: created.id, synced_at: new Date().toISOString() })
        .eq('id', event.id);
      return json({ success: true, google_event_id: created.id });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

async function fetchGoogleCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<GoogleEvent[]> {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    const calRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const calData = await calRes.json();
    if (!calRes.ok) {
      throw new Error(calData.error?.message ?? 'Failed to fetch Google Calendar events');
    }

    items.push(...(calData.items ?? []));
    pageToken = calData.nextPageToken;
  } while (pageToken);

  return items;
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  return data.access_token;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function isAllDayCalendarEvent(event: { start_at: string; end_at: string }): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(event.start_at)) return true;
  if (!/^\d{4}-\d{2}-\d{2}T00:00:00/.test(event.start_at)) return false;
  const startDay = event.start_at.slice(0, 10);
  const endDay = event.end_at.slice(0, 10);
  if (endDay === startDay) return true;
  const nextDay = new Date(`${startDay}T12:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayKey = nextDay.toISOString().slice(0, 10);
  return endDay === nextDayKey && /^\d{4}-\d{2}-\d{2}T00:00:00/.test(event.end_at);
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface SyncEventRow {
  title: string;
  start_at: string;
  end_at: string;
  description: string | null;
}

interface SyncChangeItem {
  title: string;
  start_at: string;
  end_at: string;
}

interface SyncUpdatedItem extends SyncChangeItem {
  previous?: SyncChangeItem;
  changed_fields?: Array<'title' | 'start_at' | 'end_at' | 'description'>;
}

function toChangeItem(row: SyncEventRow): SyncChangeItem {
  return { title: row.title, start_at: row.start_at, end_at: row.end_at };
}

function normalizeDescription(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Compare calendar times by instant, not raw string (Google vs Postgres formats differ). */
function calendarTimesEqual(a: string, b: string): boolean {
  return calendarTimeKey(a) === calendarTimeKey(b);
}

function calendarTimeKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `date:${value}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return `raw:${value}`;
  const iso = parsed.toISOString();
  // Date-only Google events are often stored in Postgres as UTC midnight.
  if (iso.endsWith('T00:00:00.000Z')) {
    return `date:${iso.slice(0, 10)}`;
  }
  return `ms:${parsed.getTime()}`;
}

function getChangedFields(
  existing: SyncEventRow,
  incoming: SyncEventRow
): Array<'title' | 'start_at' | 'end_at' | 'description'> {
  const changed: Array<'title' | 'start_at' | 'end_at' | 'description'> = [];
  if (existing.title !== incoming.title) changed.push('title');
  if (!calendarTimesEqual(existing.start_at, incoming.start_at)) changed.push('start_at');
  if (!calendarTimesEqual(existing.end_at, incoming.end_at)) changed.push('end_at');
  if (normalizeDescription(existing.description) !== normalizeDescription(incoming.description)) {
    changed.push('description');
  }
  return changed;
}
