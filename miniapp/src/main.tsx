import ReactDOM from 'react-dom/client'
import { miniApp, retrieveLaunchParams, useSignal } from '@telegram-apps/sdk-react'
import { AppRoot } from '@telegram-apps/telegram-ui'
import '@telegram-apps/telegram-ui/dist/styles.css'
import './index.css'
import { initTelegram } from './telegram'
import { BOT_USERNAME, MINI_APP_NAME } from './lib/config'
import App from './App'

const inTelegram = initTelegram()

function detectPlatform(): 'ios' | 'base' {
  if (!inTelegram) return 'base'
  const platform = retrieveLaunchParams().tgWebAppPlatform
  return platform === 'ios' || platform === 'macos' ? 'ios' : 'base'
}

function Root() {
  const isDark = useSignal(miniApp.isDark)
  return (
    <AppRoot
      appearance={inTelegram ? (isDark ? 'dark' : 'light') : undefined}
      platform={detectPlatform()}
    >
      <App />
    </AppRoot>
  )
}

if (!inTelegram) {
  window.location.href = `https://t.me/${BOT_USERNAME}/${MINI_APP_NAME}`
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(<Root />)
}
