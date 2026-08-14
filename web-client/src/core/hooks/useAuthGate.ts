// Проверка авторизации при старте + вход/выход. false — экран входа, true — Shell.
// logout() отсюда — только команда воркеру; реакция (в т.ч. перезагрузка под
// оставшимся аккаунтом при мультиаккаунте) приходит обратно событием
// rt:logging_out, одинаково во все вкладки.
//
// Как tweb: authed решается по ЛОКАЛЬНОМУ состоянию (наличие session_token в IDB,
// bootData.hasToken), а не по сети — поэтому промежуточного null нет, приложение
// (или экран входа) рисуется сразу, без стартового спиннера. Сетевой me() в фоне
// подтверждает/опровергает: истёкшая сессия → logout (миг пустого Shell, как в tweb).
import { useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import { PREV_ACCOUNT_KEY } from '../accountTransition'
import { bootData, bootPrefetch, invalidateBootPrefetch } from '../../client/bootData'
import { resetAppState } from '../../stores/appState'
import { resetStateCache } from '../state/loadState'
import { useChatsStore } from '../../stores/chatsStore'
import { useChatStackStore } from '../../stores/chatStackStore'
import { clearChatPositions } from '../chat/chatPositions'
import { runWhenUnlocked } from '../../stores/lockStore'
import rootScope from '@lib/rootScope'
import { RT } from '../realtime/events'

export interface AuthGate {
  authed: boolean
  login: () => void
  logout: () => void
}

// Сбросы «прошлого аккаунта из памяти»: без них конфиг/диалоги прошлого
// аккаунта дожили бы до входа под следующим, и cache-first (`loadFolders` и
// т.п.: `if (!folders.length || overwrite)`) отменил бы запрос к сети, показав
// чужие данные. Единственный вызывающий — обработчик rt:logging_out ниже,
// одинаково во всех вкладках (включая ту, где нажали «Выйти»): перезагрузки в
// этой ветке не будет, значит `boot.ts` второй раз не отработает — а он
// единственное место, где State поднимается с диска в память.
function resetAccountStateInMemory(): void {
  resetStateCache()
  resetAppState()
  // ИСКЛЮЧЕНИЕ из «пишет только проектор» (см. stores/noDuplicateDialogs.test.ts,
  // allow-list) — список диалогов тоже держится в памяти (зеркало): без сброса
  // чужие чаты видны до ответа владельца под новым аккаунтом. Владелец
  // (dialogsManager) на этом же переходе чистит СВОЙ кэш (`resetForLogout()`,
  // workerCore.ts::onLoggingOut), но rt:dialog_op reset НЕ публикует — очистка
  // зеркала здесь и есть единственный способ снять чужие диалоги с экрана этой
  // вкладки прямо сейчас, а не после следующего fillMirror()/refresh().
  // `setDialogs([])` (Task 6 снесла легаси-путь) заменяет пустая операция
  // reset — тот же метод и тот же вход, что и у storeProjection.
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items: [] }])
  // Стек инстансов колонки чата (chatStackStore) и сохранённые позиции ленты
  // (chatPositions) переживают эту функцию сами по себе — ни один из них не
  // читает State/дисковый персист, оба живут только в памяти вкладки. Без
  // явной очистки здесь колонка чата после входа под ДРУГИМ аккаунтом
  // показала бы прежний стек: `resolveChat` в App.tsx всегда возвращает
  // ChatEntity (реальный/черновик/синтетический фолбэк для несуществующего у
  // нового аккаунта peerId) и никогда не отдаёт null, поэтому пустой стек не
  // подставляется сам собой — нужен явный clear(). Позиции держат смысл
  // только вместе со своим peerId/threadId ЭТОГО аккаунта; чужие координаты
  // под чужими id — мусор, который в лучшем случае не совпадёт ни с одним
  // реальным чатом, а в худшем случае по счастливому совпадению id откроет
  // чат нового аккаунта не с той позиции.
  useChatStackStore.getState().clear()
  clearChatPositions()
}

export function useAuthGate(): AuthGate {
  const managers = useManagers()
  // Локальное решение: есть токен → оптимистично Shell, нет → экран входа.
  const [authed, setAuthed] = useState<boolean>(!!bootData?.hasToken)
  // Актуальный authed для обработчиков событий. Эффект подписки зависит только
  // от managers — вешать его заново на каждую смену authed нельзя (перевесилась
  // бы подписка и повторно запустился бы confirm()), поэтому замыкание внутри
  // видит значение первого рендера. Ref обходит это, не трогая зависимости.
  const authedRef = useRef(authed)
  authedRef.current = authed

  useEffect(() => {
    // Под passcode-локом сетевой me() НЕ шлём (RPC не летят до разблокировки):
    // подтверждаем сессию сразу после unlock. Префетч bootData.me переиспользуем
    // только если старт был не под локом — иначе это пустышка, тянем свежий me().
    const confirm = () => {
      ;(bootPrefetch()?.me ?? managers.auth.me())
        .then((u) => {
          if (u) setAuthed(true)
          else { setAuthed(false); void managers.persist.clearAll() } // сессия истекла — сбрасываем персист
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
    //    Цена, которой у tweb нет (там аккаунт живёт в URL и перезагружается
    //    ТОЛЬКО вкладка, где нажали переключение, — у нас активный токен один
    //    на все вкладки, и промолчать нельзя): соседняя вкладка теряет
    //    несохранённый ввод — до 2.5 с набранного текста
    //    (useComposerDraft.ts: SAVE_DEBOUNCE_MS) и открытую форму EditProfile
    //    целиком. Убрать это можно только пер-вкладочным аккаунтом, то есть
    //    переделкой мультиаккаунта.
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
      // Активный токен под страницей уже не тот, при котором поднимали префетч
      // старта, — обесценить его ДО любой реакции (см. докблок bootPrefetch).
      invalidateBootPrefetch()
      if (migrateTo !== null) { location.reload(); return }
      void managers.persist.clearAll()
      resetAccountStateInMemory()
      setAuthed(false)
    }
    // Симметричный кадр входа (порт tweb `account_logged_in`). Вход — такой же
    // переход активного токена, как логаут и переезд: пока его не было, вкладка,
    // не нажимавшая «Войти», о новой сессии не узнавала вовсе. Реакция
    // считается из объявленного намерения ПЛЮС собственного состояния вкладки —
    // ровно как у tweb `onLoggedOut`, который сверяет payload со своим
    // `getCurrentAccount()` (`apiManagerProxy.ts:565-585`):
    //  - вкладка была на экране входа (`authed === false`) — просто поднимаем
    //    Shell, ровно как login() ниже у вкладки, которая вошла сама.
    //    Перезагружать незачем: всё, чем эта вкладка отличается от вошедшей, —
    //    префетч старта, поднятый под ПРОШЛЫМ токеном (она-то страницу не
    //    перезагружала), и он обесценен строкой ниже. Остальное монтирующийся
    //    Shell догружает сетью под текущим токеном, а конфиг/диалоги прошлого
    //    аккаунта из памяти снял `resetAccountStateInMemory` выше, когда эта
    //    вкладка уходила на экран входа.
    //  - вкладка уже держала сессию (`authed === true`) — под ней сменился
    //    активный токен (её собственный кадр входа сюда попасть не может:
    //    вошедшая вкладка к этому моменту на экране входа). Нужен полноценный
    //    подъём под новым токеном — reload, тот же путь, что у переезда выше.
    // По `userId` не разветвляемся сознательно: любой успешный вход выдаёт
    // НОВЫЙ токен, включая повторный вход того же пользователя, — переход
    // одинаков в обоих случаях.
    const onLoggedIn = () => {
      // То же, что и на уходе: сессия сменилась — префетч старта недействителен.
      // Здесь это прямо обязательное условие ветки ниже: она поднимает Shell БЕЗ
      // перезагрузки, то есть useAppBootstrap отработает повторно в той же жизни
      // страницы и без этой строки взял бы префетч ПРОШЛОГО аккаунта.
      invalidateBootPrefetch()
      if (authedRef.current) { location.reload(); return }
      setAuthed(true)
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
    rootScope.addEventListener(RT.loggedIn, onLoggedIn)

    return () => {
      cleanupConfirm()
      rootScope.removeEventListener(RT.loggingOut, onLoggingOut)
      rootScope.removeEventListener(RT.loggedIn, onLoggedIn)
    }
  }, [managers])

  const login = () => {
    // новый аккаунт вошёл — «предыдущий аккаунт» для кнопки возврата больше не нужен
    localStorage.removeItem(PREV_ACCOUNT_KEY)
    setAuthed(true)
  }

  // Только КОМАНДА. Реакцию — сбросы, экран входа, перезагрузку под оставшимся
  // аккаунтом — целиком делает обработчик rt:logging_out выше, тем же путём,
  // что и в соседних вкладках. Локального дубля здесь быть не может даже
  // «ради отзывчивости»: authManager публикует намерение ВНУТРИ себя, до того
  // как ответ RPC поедет обратно, а кадры одного порта доставляются по
  // порядку — обработчик отрабатывает строго РАНЬШЕ, чем резолвится этот
  // промис, в любом исполнении. Дубль был бы вторым независимым выводом того
  // же факта (Stage 1C.2) без единого сценария, где он успевает первым.
  //
  // Чистку персиста тоже не дублируем: в ветке логаута её делает обработчик, а
  // в ветке переезда она не нужна — там будет reload, а `boot.ts` на старте
  // зовёт persistScope(новый токен), который стирает данные предыдущего
  // аккаунта до гидрации (core/store/persist.ts: «был другой аккаунт —
  // стереть его данные»).
  const logout = () => {
    // Общей точкой commandThenReload (её используют остальные инициаторы) НЕ
    // пользуемся сознательно: она перезагружает при ЛЮБОМ исходе, а успешный
    // логаут без остающихся аккаунтов обязан обойтись без reload — Shell
    // снимается сам через authed=false (см. обработчик выше). Перезагрузка
    // нужна ровно на отказе: исход неизвестен (токен мог быть снят, а мог и
    // нет), вкладка иначе осталась бы в интерфейсе уже вышедшего аккаунта
    // плюс unhandled rejection.
    void managers.auth.logout().catch(() => { location.reload() })
  }

  return { authed, login, logout }
}
