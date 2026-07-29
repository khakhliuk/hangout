import { useEffect } from 'react'
import { settingsButton } from '@telegram-apps/sdk-react'

export function useSettingsButton(onClick: () => void) {
  useEffect(() => {
    if (!settingsButton.mount.isAvailable()) return
    settingsButton.mount()
    settingsButton.show()
    const off = settingsButton.onClick(onClick)
    return () => {
      off()
      settingsButton.hide()
    }
  }, [onClick])
}
