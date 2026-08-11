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
import rootScope from '@lib/rootScope'
import { RT } from '../realtime/events'

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

    // Переход активной сессии (Stage 1C.2, Task 1, раунд 4). Слушаем
    // НАМЕРЕНИЕ (rt:logging_out — порт tweb `logging_out`, публикует
    // authManager, единственный владелец активного токена), а не значение
    // `me`. Раньше здесь стояла реакция на rt:me с базовой строкой
    // «первое событие — не реакция»: из одного снимка пользователя намерение
    // не выводится (null одинаков у логаута, у «данных ещё нет» и у
    // офлайн-старта; не-null id — у чужого переезда и у собственного
    // boot-подтверждения), и любая эвристика поверх этого промахивалась —
    // Critical 1 / Important 3-4 в task-1-findings-round4.md. Владелец знает
    // намерение точно и объявляет его сам:
    //  - migrateTo !== null — активный токен переехал на другой уже вошедший
    //    аккаунт (switchAccount / logout / deleteAccount с остающимся).
    //    authed сбрасывать НЕЛЬЗЯ (сессия жива, просто другая) — нужен
    //    полноценный подъём под новым токеном (dialogs/folders/State), а
    //    useAppBootstrap на повторный прогон без перезагрузки не рассчитан
    //    (`boot.ts` — единственное место, где State поднимается с диска в
    //    память). Как в tweb: смена аккаунта — это reload
    //    (`lib/accounts/changeAccount.ts` → appNavigationController.reload).
    //  - migrateTo === null — активного аккаунта не осталось (логаут,
    //    удаление последнего, «добавить аккаунт», отозванная сессия): те же
    //    сбросы, что у local logout() ниже, без reload — Shell снимется сам
    //    через authed=false.
    // Кадр приходит и вкладке-ИНИЦИАТОРУ (workerScope шлёт во все порты; у
    // tweb `logging_out` тоже общий для всех вкладок — apiManagerProxy.ts:330
    // commonEventNames). Это не мешает её exit-анимации: все инициаторы, как
    // и в tweb (`sidebarLeft/index.ts:830-837`, `:1643-1652`), играют её ДО
    // команды, а не после, и их собственный reload после уже идущей навигации
    // — no-op.
    const onLoggingOut = ({ migrateTo }: { migrateTo: number | null }) => {
      if (migrateTo !== null) { location.reload(); return }
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
    // — пустой массив, тела цикла не будет). Под локом кадр до rootScope
    // просто не долетит, кем бы его ни встречала эта подписка — регистрировать
    // её здесь синхронно дёшево и безопасно.
    rootScope.addEventListener(RT.loggingOut, onLoggingOut)

    return () => { cleanupConfirm(); rootScope.removeEventListener(RT.loggingOut, onLoggingOut) }
  }, [managers])

  const login = () => {
    // новый аккаунт вошёл — «предыдущий аккаунт» для кнопки возврата больше не нужен
    localStorage.removeItem(PREV_ACCOUNT_KEY)
    setAuthed(true)
  }

  // Локальный путь логаута. То же самое (и в этой вкладке тоже) делает
  // обработчик rt:logging_out выше — воркер объявляет намерение раньше, чем
  // резолвится этот RPC, и обе ветки идемпотентны. Держим локальный путь как
  // подтверждение действия, не зависящее от эха воркера: пользователь нажал
  // «Выйти» ЗДЕСЬ, и экран входа не должен ждать доставки кадра.
  const logout = () => {
    void clearDialogsPersist(managers)
    void managers.auth.logout()
      .then((r) => {
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
        // разошлёт rt:me:null остальным вкладкам той же сессии.
        useChatsStore.getState().setMe(null)
        setAuthed(false)
      })
      // Important 2 раунда 4: без .catch отказ RPC (IDB-сбой при работе с
      // реестром аккаунтов) оставлял вкладку в интерфейсе уже вышедшего
      // аккаунта — плюс unhandled rejection. Исход неизвестен: токен мог быть
      // снят, а мог и нет, — перезагружаемся и выводим состояние с диска
      // заново (tweb в logOut() тоже доводит очистку через finally, а не
      // бросает наружу: apiManager.ts:341-345).
      .catch(() => { location.reload() })
  }

  return { authed, login, logout }
}
