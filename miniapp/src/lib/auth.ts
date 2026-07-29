import { retrieveRawInitData } from '@telegram-apps/sdk-react'
import { authorize, getSupabase } from './supabase'

export type TgUser = {
  id: number
  first_name: string
  username: string | null
  photo_url: string | null
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// On some mobile clients (mostly Android) the WebView can report itself as
// "in Telegram" before the launch params are actually populated yet, so the
// very first read can come back empty even though this really is running
// inside Telegram. A couple of short retries before giving up avoids a false
// "Апка запущена поза Telegram" on a cold start.
async function getInitData(): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = retrieveRawInitData()
    if (data) return data
    if (attempt < 2) await wait(150 * (attempt + 1))
  }
  return null
}

export async function login(): Promise<TgUser> {
  const initData = await getInitData()
  if (!initData) {
    throw new Error('Апка запущена поза Telegram')
  }

  // The auth edge function chains several sequential network calls
  // internally (Supabase Admin API + DB), so a single transient blip on a
  // mobile connection is enough to fail it outright — retry a couple times
  // before surfacing an error to the user.
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data, error } = await getSupabase().functions.invoke('auth', { body: { initData } })
      if (error) throw error
      authorize(data.token)
      return data.user
    } catch (e) {
      lastError = e
      if (attempt < 2) await wait(400 * (attempt + 1))
    }
  }
  console.error('login failed after retries:', lastError)
  throw new Error('Не вдалося авторизуватись')
}
