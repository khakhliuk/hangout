import { useEffect } from 'react'
import { backButton } from '@telegram-apps/sdk-react'

export function useBackButton(onBack: () => void) {
  useEffect(() => {
    if (!backButton.mount.isAvailable()) return
    backButton.mount()
    backButton.show()
    const off = backButton.onClick(onBack)
    return () => {
      off()
      backButton.hide()
    }
  }, [onBack])
}
