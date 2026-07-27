// Проверка авторизации при старте + вход/выход. false — экран входа, true — Shell.
// logout при мультиаккаунте перезагружает под оставшимся аккаунтом.
//
// Как tweb: authed решается по ЛОКАЛЬНОМУ состоянию (наличие session_token в IDB,
// bootData.hasToken), а не по сети — поэтому промежуточного null нет, приложение
// (или экран входа) рисуется сразу, без стартового спиннера. Сетевой me() в фоне
// подтверждает/опровергает: истёкшая сессия → logout (миг пустого Shell, как в tweb).
import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { PREV_ACCOUNT_KEY } from '../accountTransition'
import { bootData } from '../../client/bootData'
import { clearDialogsPersist } from '../../stores/dialogsPersist'
import { runWhenUnlocked } from '../../stores/lockStore'

export interface AuthGate {
  authed: boolean
  login: () => void
  logout: () => void
}

export function useAuthGate(): AuthGate {
  const managers = useManagers()
  // Локальное решение: есть токен → оптимистично Shell, нет → экран входа.
  const [authed, setAuthed] = useState<boolean>(!!bootData?.hasToken)

  useEffect(() => {
    // Под passcode-локом сетевой me() НЕ шлём (RPC не летят до разблокировки):
    // подтверждаем сессию сразу после unlock. Префетч bootData.me переиспользуем
    // только если старт был не под локом — иначе это пустышка, тянем свежий me().
    const confirm = () => {
      ;((bootData && !bootData.locked && bootData.me) || managers.auth.me())
        .then((u) => {
          if (u) setAuthed(true)
          else { setAuthed(false); void clearDialogsPersist() } // сессия истекла — сбрасываем персист
        })
        .catch(() => {
          // Сеть недоступна: с валидным токеном остаёмся в оффлайн-режиме (authed уже
          // true); без токена — экран входа.
          if (!bootData?.hasToken) setAuthed(false)
        })
    }
    return runWhenUnlocked(confirm)
  }, [managers])

  const login = () => {
    // новый аккаунт вошёл — «предыдущий аккаунт» для кнопки возврата больше не нужен
    localStorage.removeItem(PREV_ACCOUNT_KEY)
    setAuthed(true)
  }

  const logout = () => {
    void clearDialogsPersist()
    void managers.auth.logout().then((r) => {
      // остался другой аккаунт (мультиаккаунт) → перезагрузка под ним; иначе экран входа
      if (r.switched) location.reload()
      else setAuthed(false)
    })
  }

  return { authed, login, logout }
}
