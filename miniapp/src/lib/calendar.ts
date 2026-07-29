// Building the .ics client-side and downloading it via a Blob + <a download>
// doesn't work inside the Telegram Mini App webview — it just renders the
// raw text instead of triggering a download. Instead, the file is served by
// a small stateless edge function (supabase/functions/ics) and opened as a
// real https:// URL via openLink, which Telegram reliably hands off to the
// device's calendar/file flow.
export function openIcsLink(opts: { title: string; startsAt: string; location?: string | null; uid?: string }): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const params = new URLSearchParams({ title: opts.title, starts_at: opts.startsAt })
  if (opts.location) params.set('location', opts.location)
  if (opts.uid) params.set('uid', opts.uid)
  return `${supabaseUrl}/functions/v1/ics?${params.toString()}`
}
