import { createClient } from 'npm:@supabase/supabase-js@2'

const encoder = new TextEncoder()

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function hmacSha256(key: Uint8Array, data: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)))
}

function hex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const botToken = Deno.env.get('BOT_TOKEN')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!botToken || !supabaseUrl || !serviceRole || !anonKey) {
    return json({ error: 'Function secrets are not configured' }, 500)
  }

  let initData: string
  try {
    const body = await req.json()
    initData = body.initData
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  if (!initData) {
    return json({ error: 'initData is required' }, 400)
  }

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) {
    return json({ error: 'Malformed initData' }, 401)
  }
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n')

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken)
  const expectedHash = hex(await hmacSha256(secretKey, dataCheckString))
  if (expectedHash !== hash) {
    return json({ error: 'Invalid initData signature' }, 401)
  }

  const authDate = Number(params.get('auth_date'))
  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    return json({ error: 'initData is expired' }, 401)
  }

  const user = JSON.parse(params.get('user') ?? '{}')
  if (!user.id) {
    return json({ error: 'No user in initData' }, 401)
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const email = `tg_${user.id}@telegram.local`
  const appMetadata = { provider: 'telegram', tg_user_id: user.id }
  const userMetadata = { first_name: user.first_name ?? null, username: user.username ?? null }

  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  })
  if (createErr && !/registered|already|exists/i.test(createErr.message)) {
    console.error('createUser failed:', createErr.message)
    return json({ error: 'Не вдалося створити користувача' }, 500)
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkErr || !link?.properties?.hashed_token || !link?.user?.id) {
    console.error('generateLink failed:', linkErr?.message)
    return json({ error: 'Не вдалося видати сесію' }, 500)
  }

  // Single source of truth for the profile, keyed to the real auth user.
  const { error: profileErr } = await admin.from('profiles').upsert(
    {
      id: link.user.id,
      tg_user_id: user.id,
      first_name: user.first_name ?? '',
      username: user.username ?? null,
      avatar_url: user.photo_url ?? null,
    },
    { onConflict: 'id' },
  )
  if (profileErr) {
    console.error('profiles upsert failed:', profileErr.message)
    return json({ error: 'Не вдалося оновити профіль' }, 500)
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(link.user.id, {
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  })
  if (updateErr) {
    console.error('updateUserById failed:', updateErr.message)
    return json({ error: 'Не вдалося оновити користувача' }, 500)
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (verifyErr || !verified?.session) {
    console.error('verifyOtp failed:', verifyErr?.message)
    return json({ error: 'Не вдалося підтвердити сесію' }, 401)
  }

  return json({
    token: verified.session.access_token,
    user: {
      id: user.id,
      first_name: user.first_name,
      username: user.username ?? null,
      photo_url: user.photo_url ?? null,
    },
  })
})
