import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
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
      const calendarId = settings.google_calendar_id ?? 'primary';
      const now = new Date();
      const weekLater = new Date(now.getTime() + 30 * 86400000);
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${now.toISOString()}&timeMax=${weekLater.toISOString()}&singleEvents=true&orderBy=startTime`;
      const calRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const calData = await calRes.json();
      const events = (calData.items ?? []).map((item: GoogleEvent) => ({
        google_event_id: item.id,
        title: item.summary ?? 'Event',
        start_at: item.start?.dateTime ?? item.start?.date,
        end_at: item.end?.dateTime ?? item.end?.date,
        description: item.description ?? null,
        synced_at: new Date().toISOString(),
      }));

      for (const ev of events) {
        await supabase.from('calendar_events').upsert(ev, { onConflict: 'google_event_id' });
      }

      const { data } = await supabase.from('calendar_events').select('*').gte('start_at', now.toISOString());
      return json({ events: data ?? [] });
    }

    if (action === 'push' && event) {
      const calendarId = settings.google_calendar_id ?? 'primary';
      const body = {
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

interface GoogleEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}
