import { init, miniApp, themeParams, viewport, swipeBehavior } from '@telegram-apps/sdk-react'

let telegramEnv = false

export function isInTelegram() {
  return telegramEnv
}

export function initTelegram(): boolean {
  try {
    init()
  } catch {
    console.warn('Telegram environment not detected, running in browser')
    return false
  }
  telegramEnv = true

  if (miniApp.mountSync.isAvailable()) {
    miniApp.mountSync()
    miniApp.bindCssVars()
  }

  if (themeParams.mountSync.isAvailable()) {
    themeParams.mountSync()
    themeParams.bindCssVars()
  }

  if (viewport.mount.isAvailable()) {
    void viewport.mount().then(() => {
      viewport.bindCssVars()
      if (viewport.expand.isAvailable()) {
        viewport.expand()
      }
    })
  }

  if (swipeBehavior.mount.isAvailable()) {
    swipeBehavior.mount()
    if (swipeBehavior.disableVertical.isAvailable()) {
      swipeBehavior.disableVertical()
    }
  }

  if (miniApp.ready.isAvailable()) {
    miniApp.ready()
  }

  return true
}
