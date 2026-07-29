import { useEffect, useState } from 'react'
import { retrieveLaunchParams } from '@telegram-apps/sdk-react'
import { Button, Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { login, type TgUser } from './lib/auth'
import { isInTelegram } from './telegram'
import Main from './screens/Main'

function getStartParam(): string | null {
  try {
    const param = retrieveLaunchParams().tgWebAppStartParam
    return param && param.length > 0 ? param : null
  } catch {
    return null
  }
}

export default function App() {
  const [user, setUser] = useState<TgUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isInTelegram()) {
      setUser({ id: 0, first_name: 'Дев', username: null, photo_url: null })
      return
    }
    login()
      .then(setUser)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Щось пішло не так'))
  }, [])

  if (error) {
    return (
      <Placeholder header="Не вдалося увійти" description={error}>
        <div style={{ marginTop: 24 }}>
          <Button size="m" onClick={() => window.location.reload()}>
            Перезавантажити
          </Button>
        </div>
      </Placeholder>
    )
  }

  if (!user) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 'var(--tg-viewport-stable-height, 100vh)',
        }}
      >
        <Spinner size="l" />
      </div>
    )
  }

  return <Main user={user} startParam={getStartParam()} />
}
