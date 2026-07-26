// Проверка авторизации при старте + вход/выход. authed=null — идёт проверка
// (рендерим ничего), false — экран входа, true — Shell. logout при мультиаккаунте
// перезагружает под оставшимся аккаунтом.
//
// Offline-first: если список чатов уже отрисован из IDB-кэша (bootData), стартуем
// с authed=true оптимистично и подтверждаем/опровергаем сетевым me() в фоне —
// как tweb (auth из кэша, реконсайл сетью). При отсутствии кэша — как раньше:
// authed=null до ответа сети.
import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { PREV_ACCOUNT_KEY } from '../accountTransition'
import { bootData } from '../../client/bootData'
import { clearChatsCache } from '../../stores/chatsCache'

export interface AuthGate {
  authed: boolean | null
  login: () => void
  logout: () => void
}

export function useAuthGate(): AuthGate {
  const managers = useManagers()
  const [authed, setAuthed] = useState<boolean | null>(bootData?.hydratedFromCache ? true : null)

  useEffect(() => {
    ;(bootData?.me ?? managers.auth.me())
      .then((u) => {
        if (u) setAuthed(true)
        else { setAuthed(false); void clearChatsCache() } // сессия истекла — сбрасываем кэш
      })
      .catch(() => {
        // Сеть недоступна: с кэшем остаёмся в оффлайн-режиме (authed уже true),
        // без кэша — экран входа.
        if (!bootData?.hydratedFromCache) setAuthed(false)
      })
  }, [managers])

  const login = () => {
    // новый аккаунт вошёл — «предыдущий аккаунт» для кнопки возврата больше не нужен
    localStorage.removeItem(PREV_ACCOUNT_KEY)
    setAuthed(true)
  }

  const logout = () => {
    void clearChatsCache()
    void managers.auth.logout().then((r) => {
      // остался другой аккаунт (мультиаккаунт) → перезагрузка под ним; иначе экран входа
      if (r.switched) location.reload()
      else setAuthed(false)
    })
  }

  return { authed, login, logout }
}
