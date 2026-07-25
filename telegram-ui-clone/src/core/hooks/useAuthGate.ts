// Проверка авторизации при старте + вход/выход. authed=null — идёт проверка
// (рендерим ничего), false — экран входа, true — Shell. logout при мультиаккаунте
// перезагружает под оставшимся аккаунтом.
import { useEffect, useState } from 'react'
import type { Managers } from '../../client/bootstrap'
import { PREV_ACCOUNT_KEY } from '../accountTransition'

export interface AuthGate {
  authed: boolean | null
  login: () => void
  logout: () => void
}

export function useAuthGate(managers: Managers): AuthGate {
  const [authed, setAuthed] = useState<boolean | null>(null) // null = checking

  useEffect(() => {
    managers.auth.me().then((u) => setAuthed(!!u)).catch(() => setAuthed(false))
  }, [managers])

  const login = () => {
    // новый аккаунт вошёл — «предыдущий аккаунт» для кнопки возврата больше не нужен
    localStorage.removeItem(PREV_ACCOUNT_KEY)
    setAuthed(true)
  }

  const logout = () => {
    void managers.auth.logout().then((r) => {
      // остался другой аккаунт (мультиаккаунт) → перезагрузка под ним; иначе экран входа
      if (r.switched) location.reload()
      else setAuthed(false)
    })
  }

  return { authed, login, logout }
}
