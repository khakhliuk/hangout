import { openLink, openTelegramLink, retrieveLaunchParams, shareURL } from '@telegram-apps/sdk-react'
import { BOT_USERNAME } from './config'
import { isInTelegram } from '../telegram'

// Opening maps links is broken on Telegram Desktop (both the bridge and
// plain window navigation), so the feature is simply hidden there instead of
// chasing it — it works fine on mobile clients, which is what matters most.
export function mapsLinkVisible(): boolean {
  if (!isInTelegram()) return true
  try {
    const platform = retrieveLaunchParams().tgWebAppPlatform
    return platform === 'ios' || platform === 'android' || platform === 'android_x'
  } catch {
    return false
  }
}

export function openAddBotLink() {
  const link = `https://t.me/${BOT_USERNAME}?startgroup=true`
  if (isInTelegram() && openTelegramLink.isAvailable()) {
    openTelegramLink(link)
  } else {
    window.open(link, '_blank')
  }
}

export function buildSpaceInviteLink(spaceId: string): string {
  return `https://t.me/${BOT_USERNAME}/hangout?startapp=s_${spaceId}`
}

export function shareSpaceInvite(spaceId: string, spaceTitle: string) {
  const link = buildSpaceInviteLink(spaceId)
  const text = `Приєднуйся до «${spaceTitle}» в Hangout`
  if (isInTelegram() && shareURL.isAvailable()) {
    shareURL(link, text)
  } else {
    const shareLink = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`
    window.open(shareLink, '_blank')
  }
}

export function openExternal(url: string) {
  if (isInTelegram() && openLink.isAvailable()) {
    openLink(url)
  } else {
    window.open(url, '_blank')
  }
}

export function isMapsUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export function parsePlaceInput(value: string): { name: string; mapsUrl: string | null } {
  if (isMapsUrl(value)) {
    const nameFromUrl = extractNameFromMapsUrl(value)
    return { name: nameFromUrl ?? 'Місце з Maps', mapsUrl: value }
  }
  return { name: value, mapsUrl: null }
}

function extractNameFromMapsUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const placeMatch = u.pathname.match(/\/maps\/place\/([^/@]+)/)
    if (placeMatch) {
      const full = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '))
      return full.split(',')[0].trim()
    }
    const q = u.searchParams.get('q')
    if (q) return q.replace(/\+/g, ' ')
  } catch { /* ignore */ }
  return null
}

export type ResolvedPlace = {
  id?: string
  name: string | null
  google_place_id: string | null
  maps_url?: string
  lat: number | null
  lng: number | null
  address?: string | null
  photo_url?: string | null
  cached?: boolean
}

export async function resolvePlace(url: string): Promise<ResolvedPlace | null> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    const resp = await fetch(`${supabaseUrl}/functions/v1/resolve-place`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ url }),
    })
    if (!resp.ok) return null
    const data: ResolvedPlace = await resp.json()
    if (data.name) data.name = data.name.split(',')[0].trim()
    return data
  } catch {
    return null
  }
}
