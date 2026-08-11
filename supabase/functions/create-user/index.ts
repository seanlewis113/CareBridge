import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_PERSONAS = ['admin', 'family_caregiver', 'hired_caregiver'] as const;
type ValidPersona = (typeof VALID_PERSONAS)[number];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing authorization header' }, 401);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('persona')
      .eq('id', callerData.user.id)
      .single();

    if (profileError || callerProfile?.persona !== 'admin') {
      return json({ error: 'Only admins can create users' }, 403);
    }

    const { email, password, displayName, persona } = await req.json();

    if (!email || !password || !displayName || !persona) {
      return json({ error: 'email, password, displayName, and persona are required' }, 400);
    }

    if (password.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, 400);
    }

    if (!VALID_PERSONAS.includes(persona as ValidPersona)) {
      return json({ error: 'Invalid persona' }, 400);
    }

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        display_name: String(displayName).trim(),
        persona,
      },
    });

    if (createError) {
      return json({ error: createError.message }, 400);
    }

    if (!newUser.user) {
      return json({ error: 'User creation failed' }, 500);
    }

    const { data: profile, error: fetchProfileError } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', newUser.user.id)
      .single();

    if (fetchProfileError || !profile) {
      const { data: upserted, error: upsertError } = await adminClient
        .from('profiles')
        .upsert({
          id: newUser.user.id,
          email: newUser.user.email,
          display_name: String(displayName).trim(),
          persona,
          avatar_url: null,
        })
        .select()
        .single();

      if (upsertError) {
        return json({ error: upsertError.message }, 500);
      }

      return json({ profile: upserted });
    }

    return json({ profile });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
