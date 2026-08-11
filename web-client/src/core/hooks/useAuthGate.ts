// Проверка авторизации при старте + вход/выход. false — экран входа, true — Shell.
// logout при мультиаккаунте перезагружает под оставшимся аккаунтом.
//
// Как tweb: authed решается по ЛОКАЛЬНОМУ состоянию (наличие session_token в IDB,
// bootData.hasToken), а не по сети — поэтому промежуточного null нет, приложение
// (или экран входа) рисуется сразу, без стартового спиннера. Сетевой me() в фоне
// подтверждает/опровергает: истёкшая сессия → logout (миг пустого Shell, как в tweb).
import { useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import { PREV_ACCOUNT_KEY } from '../accountTransition'
import { bootData } from '../../client/bootData'
import { clearDialogsPersist } from '../../stores/dialogsPersist'
import { resetAppState } from '../../stores/appState'
import { resetStateCache } from '../state/loadState'
import { useChatsStore } from '../../stores/chatsStore'
import { runWhenUnlocked } from '../../stores/lockStore'
import rootScope from '@lib/rootScope'
import { RT } from '../realtime/events'
import type { User } from '../managers/authManager'

export interface AuthGate {
  authed: boolean
  login: () => void
  logout: () => void
}

// Общие сбросы «прошлого аккаунта из памяти» (Stage 1C.2, фикс повторного
// ревью, п.3): без них конфиг/диалоги прошлого аккаунта дожили бы до входа
// под следующим, и cache-first (`loadFolders` и т.п.: `if (!folders.length ||
// overwrite)`) отменил бы запрос к сети, показав чужие данные. Один и тот же
// путь для local logout() (ветка без остающихся аккаунтов) и кросс-табового
// rt:me:null ниже — раньше это жило только в первом, и обработчик rt:me
// молчаливо ничего из этого не делал.
function resetAccountStateInMemory(): void {
  resetStateCache()
  resetAppState()
  // Список диалогов тоже держится в памяти: без сброса чужие чаты видны до
  // ответа /chats под новым аккаунтом.
  useChatsStore.getState().setDialogs([])
}

export function useAuthGate(): AuthGate {
  const managers = useManagers()
  // Локальное решение: есть токен → оптимистично Shell, нет → экран входа.
  const [authed, setAuthed] = useState<boolean>(!!bootData?.hasToken)
  // Идентичность, которую эта вкладка уже видела через rt:me. `undefined` —
  // ни одного rt:me ещё не было: намеренно НЕ сеется из
  // useChatsStore.getState().meId (гидратация с диска) — гидратации может не
  // быть вовсе (первая сессия на устройстве, passcode-лок), и тогда null
  // «нет данных с диска» неотличим от null «аккаунтов не осталось», а вторая
  // вкладка с authed=true и уже протухшим `meId` — ровно тот баг, который эта
  // проверка обязана ловить. Первое rt:me этой вкладке (от её же boot-цепочки
  // воркера, подтверждающее ТЕКУЩИЙ аккаунт) — только база, не реакция; любое
  // ПОСЛЕДУЮЩЕЕ, отличное от базы — реальная смена (см. onMe ниже).
  const lastMeId = useRef<number | null | undefined>(undefined)

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
    const cleanupConfirm = runWhenUnlocked(confirm)

    // Кросс-табовый переход между аккаунтами (Stage 1C.2, фикс повторного
    // ревью, п.1-п.3): rt:me теперь публикуется не только на логаут, но и на
    // смену/удаление активного аккаунта (authManager.ts: logout/
    // switchAccount/deleteAccount) — эта вкладка могла НЕ быть инициатором.
    // Реакция зависит от того, ЧТО пришло:
    //  - id совпал с уже известным этой вкладке — просто поле профиля
    //    обновилось (аватар/имя/премиум), не смена личности; storeProjection
    //    уже применил мердж в стор — здесь делать нечего.
    //  - id сменился на ДРУГОЙ (не null) — активный токен переключился на
    //    другой уже вошедший аккаунт (switchAccount/deleteAccount с
    //    остающимся аккаунтом, либо логаут этой сессии при живой B). authed
    //    здесь НЕЛЬЗЯ ставить в false (сессия B активна) — нужен полноценный
    //    подъём под новым токеном (dialogs/folders/State), а
    //    useAppBootstrap на повторный прогон без перезагрузки не рассчитан
    //    (`boot.ts` — единственное место, где State поднимается с диска в
    //    память) — reload, тем же способом, что делает инициирующая вкладка
    //    (MainMenu.switchTo/PrivacySecuritySettings). Та вкладка ещё и играет
    //    exit-анимацию перед reload — здесь её нет (не инициатор), поэтому
    //    кадр может смениться на долю секунды раньше; повторный
    //    location.reload() из инициирующей вкладки после уже идущей
    //    навигации — no-op, не баг.
    //  - id стал null — аккаунтов не осталось, настоящий логаут: те же
    //    сбросы, что local logout() ниже (resetAccountStateInMemory), без
    //    reload — Shell снимется сам через authed=false.
    const onMe = (u: User | null) => {
      const id = u?.id ?? null
      // Первое rt:me этой вкладке — только база (см. докблок у lastMeId), не
      // повод перезагружаться/сбрасываться.
      if (lastMeId.current === undefined) { lastMeId.current = id; return }
      if (id === lastMeId.current) return
      lastMeId.current = id
      if (id !== null) { location.reload(); return }
      void clearDialogsPersist(managers)
      resetAccountStateInMemory()
      setAuthed(false)
    }
    // Подписку НЕ гейтим runWhenUnlocked (в отличие от confirm() выше) — не
    // потому что воркер/RPC не подняты под локом (это не так: `client/
    // boot.ts` зовёт `startClient()` безусловно, ДО решения о локе, и
    // `workerCore.ts`'s `tokens.ready().then(() => auth.me())` идёт в /me
    // независимо от пасскода). Настоящая причина — насос `smp.on(...)`
    // (`realtimeBridge.ts`), который вообще доставляет кадры от воркера в
    // rootScope, регистрируется только в `startRealtime()`, а тот сам
    // гейтится `runWhenUnlocked` (`useAppBootstrap.ts`); `SuperMessagePort`
    // без слушателя на конкретное событие молча его роняет
    // (`superMessagePort.ts`: `for (const cb of this.listeners.get(...) ?? [])`
    // — пустой массив, тела цикла не будет). Под локом rt:me до rootScope
    // просто не долетит, кем бы её ни встречала эта подписка — регистрировать
    // её здесь синхронно дёшево и безопасно.
    rootScope.addEventListener(RT.me, onMe)

    return () => { cleanupConfirm(); rootScope.removeEventListener(RT.me, onMe) }
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
      resetAccountStateInMemory()
      // ИСКЛЮЧЕНИЕ из «пишет только проектор» (Stage 1C.2, Task 1 — см. докблок
      // setMe в chatsStore.ts, stores/noDuplicateMe.test.ts): логаут подтверждён
      // RPC, но `me` чистим синхронно тем же блоком, что dialogs/State — единый
      // локальный сброс перед экраном входа, ждать сетевой round-trip ради null
      // незачем. Воркер (authManager.logout → onMeChanged(null)) отдельно
      // разошлёт rt:me:null остальным вкладкам той же сессии (см. onMe выше).
      useChatsStore.getState().setMe(null)
      setAuthed(false)
    })
  }

  return { authed, login, logout }
}
