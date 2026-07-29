import { showPopup } from '@telegram-apps/sdk-react'
import { isInTelegram } from '../telegram'

export async function confirmDestructive(message: string, confirmText: string): Promise<boolean> {
  if (isInTelegram() && showPopup.isAvailable()) {
    const buttonId = await showPopup({
      message,
      buttons: [
        { id: 'confirm', type: 'destructive', text: confirmText },
        { id: 'cancel', type: 'cancel' },
      ],
    })
    return buttonId === 'confirm'
  }
  return window.confirm(message)
}
