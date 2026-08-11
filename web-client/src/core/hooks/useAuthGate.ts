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
import { resetAppState } from '../../stores/appState'
import { resetStateCache } from '../state/loadState'
import { useChatsStore } from '../../stores/chatsStore'
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
          else { setAuthed(false); void clearDialogsPersist(managers) } // сессия истекла — сбрасываем персист
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
    void clearDialogsPersist(managers)
    void managers.auth.logout().then((r) => {
      // остался другой аккаунт (мультиаккаунт) → перезагрузка под ним; иначе экран входа
      if (r.switched) { location.reload(); return }
      // Перезагрузки НЕ будет, значит boot.ts второй раз не отработает — а он
      // единственное место, где State поднимается с диска в память. Без сброса
      // конфиг прошлого аккаунта дожил бы до входа под следующим, и cache-first
      // (папки/черновики/баланс) ОТМЕНИЛ бы запрос к сети, показав чужие данные.
      // clearDialogsPersist выше чистит только диск.
      resetStateCache()
      resetAppState()
      // Список диалогов тоже держится в памяти: без сброса чужие чаты видны до
      // ответа /chats под новым аккаунтом.
      useChatsStore.getState().setDialogs([])
      // ИСКЛЮЧЕНИЕ из «пишет только проектор» (Stage 1C.2, Task 1 — см. докблок
      // setMe в chatsStore.ts, stores/noDuplicateMe.test.ts): логаут подтверждён
      // RPC, но `me` чистим синхронно тем же блоком, что dialogs/State — единый
      // локальный сброс перед reload/экраном входа, ждать сетевой round-trip
      // ради null незачем. Воркер (authManager.logout → onMeChanged(null))
      // отдельно разошлёт rt:me:null остальным вкладкам той же сессии.
      useChatsStore.getState().setMe(null)
      setAuthed(false)
    })
  }

  return { authed, login, logout }
}
