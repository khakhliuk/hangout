import { useEffect, useState } from 'react'

// The event list buckets rows by wall-clock time, but nothing on the home
// screen re-renders it when time simply passes — useHangoutData only polls
// while a single event is open. Without a tick, a list rendered at 22:00 still
// files yesterday's events under "Сьогодні" at 1am, because eventStatus() and
// the day comparison both read the clock at render time and then freeze.
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = setInterval(tick, intervalMs)

    // Webviews throttle timers hard while backgrounded, and a minimised mini
    // app can sit for hours without the interval firing, so the clock has to be
    // re-read the moment it comes back rather than waiting for the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', tick)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', tick)
    }
  }, [intervalMs])

  return now
}
