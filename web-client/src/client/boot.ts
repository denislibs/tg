// Единая точка холодного старта (аналог tweb index.ts): регистрируем SW, поднимаем
// воркер, СРАЗУ запускаем критические RPC (me + список диалогов), готовим всё, что
// нужно до первого кадра — offline-first кэш чатов и активный словарь — и отдаём
// managers для рендера. Всё, что можно, делается параллельно и до React.
import { startClient, type Managers } from './bootstrap'
import { installBridgeHandoff } from './dnpBridgeHandoff'
import { initPwaInstall } from '../core/pwa'
import { listenForMaskedAnchorClicks } from '@lib/richtext/maskedAnchor'
import I18n, { catchUpLangPack, suggestBrowserLangCode } from '@lib/langPack'
import rootScope from '@lib/rootScope'
import { fillLocalizedDates } from '@helpers/date'
import { setBootData } from './bootData'
import { loadStateOnce, resetStateCache, stateWasResetToDefaults } from '../core/state/loadState'
import { STATE_VERSION } from '../core/state/state'
import { setAppState, setAppStateSilent, setStateWriter } from '../stores/appState'
import { migrateRecentSearchFromLocalStorage } from '../core/state/migrateRecentSearch'
import PasscodeLockScreenController from '../components/passcodeLock/passcodeLockScreenController.solid'
import { setThemeListener } from '../core/theme/themeController'
import appChatBackground, { watchWallPaperSettings } from '../components/chat/bubbles/chatBackground.solid'
import { useSettingsStore } from '../settings'
import { installPasscodeListener } from './passcodeClient'
import { listenServiceWorkerHello, sendPasscodeStateToServiceWorker } from './passcodeServiceWorker'
import { preventCrossTabDynamicImportDeadlock } from '../core/preventDeadlock'
import { useChatsStore } from '../stores/chatsStore'
import type { DialogOp } from '../core/dialogs/dialogOps'
import type { PeerProfile } from '../core/managers/authManager'
import { bootstrapHash } from '../core/hooks/useUrlSync'
import type { LangPackDifference } from '@layer'

/**
 * Task 2 (перенос владения диалогами): пробел зеркала на холодном старте.
 * Владелец (воркерный dialogsManager) сам поднимает кэш прошлой сессии и
 * отвечает reset'ом на fillMirror().
 *
 * Вынесена отдельно от bootstrap() ради теста (boot.dialogs.test.ts):
 * bootstrap() — реальная точка входа (как core/worker.ts), конструирует
 * настоящий SharedWorker/Worker через startClient(), и managers.dialogs —
 * RPC-прокси к нему; без настоящего воркера на другом конце вызов зависнет.
 */
export function fillDialogsMirror(managers: Pick<Managers, 'dialogs'>): Promise<DialogOp | null> {
  return managers.dialogs.fillMirror()
}

/**
 * Применить ответ владельца к витрине ДО первого рендера (подписка на
 * rt:dialog_op ещё не поднята — startRealtime() стартует позже, из
 * useAppBootstrap.ts; кадры, случившиеся раньше её подписки, никто не
 * буферизует, см. web-client/CLAUDE.md «Владение фактами»). Сеть догоняет
 * отдельно (refresh) — её НЕ ждём здесь, чтобы не блокировать рендер сетью.
 *
 * `applyDialogOps` здесь — allow-listed исключение из «пишет только проектор»
 * (см. stores/noDuplicateDialogs.test.ts, как и у `core/hooks/useAuthGate.ts`):
 * это тот же метод и тот же единственный вход зеркала, что и у storeProjection,
 * просто вызванный отсюда до того, как подписка на rt:dialog_op вообще
 * поднята — не второй вывод факта.
 *
 * Fix (финальное ревью, Important #2/#3): ответ догона применяется ЗДЕСЬ ЖЕ,
 * из результата RPC, а не только бродкастом — до подъёма насоса (startRealtime()
 * из эффекта useAppBootstrap) кадр `rt:dialog_op` доставить некому, и на быстрой
 * сети reset уходил в никуда. Возвращаем промис этого догона: он уезжает в
 * `bootData` и на нём висит сид презенса (`loadPresence`), которому нужен
 * честный сигнал «сетевой список приехал» — на пустом кэше зеркало в момент
 * монтирования Shell ещё пусто. Промис намеренно НЕ отклоняется (401/5xx у
 * `refresh()` пробрасываются): остаёмся на кэше, презенс сеется тем, что есть,
 * unhandled rejection не плодим (Minor #3).
 *
 * Первичная сетевая загрузка — `refresh()`, и она страничная: на пустом кэше
 * владелец просит одну страницу (`dialogsManager.ts::doRefresh`). Дальше список
 * догружает сам сайдбар через `getDialogs` + `helpers/sequentialCursorFetcher`,
 * опираясь на размер набора своей выборки (`countFor`).
 */
export function applyDialogsMirror(op: DialogOp | null, managers: Pick<Managers, 'dialogs'>): Promise<void> {
  if (op) useChatsStore.getState().applyDialogOps([op])
  return managers.dialogs.refresh().then(
    (netOp) => { if (netOp) useChatsStore.getState().applyDialogOps([netOp]) },
    () => { /* офлайн/401 — витрина остаётся на кэше владельца */ },
  )
}

/**
 * Порт tweb `index.ts:391-400` — направление интерфейса по языку применённого
 * пакета: `dir` корня и флаг `I18n.setRTL`, по которому зеркалят ось ползунки
 * (`components/rangeSelector.ts`, `rangeSelectorTsx.solid.tsx`). RTL у tweb
 * включает только `ar`: ветка `fa` выключена в оригинале (`&& IS_BETA && false`)
 * и сюда не перенесена. Зовётся раз на старт, как и там (:462/:570) — смена
 * языка без перезагрузки направление не меняет.
 */
function setDocumentLangPackProperties(langPack: LangPackDifference) {
  if (langPack.lang_code === 'ar') {
    document.documentElement.classList.add('is-rtl')
    document.documentElement.dir = 'rtl'
    document.documentElement.lang = langPack.lang_code
    I18n.setRTL(true)
  } else {
    document.documentElement.dir = 'ltr'
  }
}

export async function bootstrap(): Promise<{ managers: Managers }> {
  // В самом начале boot (как tweb index.ts): ждём один кадр анимации, чтобы
  // отложить последующие dynamic import и не словить кросс-табовый deadlock
  // загрузки модулей в Chrome (см. preventDeadlock.ts). До решения о passcode-локе
  // и до любого ленивого import.
  await preventCrossTabDynamicImportDeadlock()

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* push unavailable */ })
  }
  // Ловим beforeinstallprompt для пункта «Установить приложение» (PWA).
  initPwaInstall()
  // Замаскированная ссылка спрашивает «Открыть ссылку?» на основной и средней
  // кнопке (tweb e96e06c37; у оригинала — `InternalLinkProcessor.construct`).
  listenForMaskedAnchorClicks()

  const { managers, ep, smp } = startClient()
  // DNP-ON: раздаём мост SW↔SharedWorker (self-gated; инертно при DNP-off).
  installBridgeHandoff(ep)

  // #0 — код-пароль ДО любых RPC с токеном и до чтения State (порт tweb
  // index.ts:453, `PasscodeLockScreenController.waitForUnlock`). Слушатель канала
  // ставится первым: разблокировка в соседней вкладке снимает экран и здесь.
  // Под замком токен лежит только в зашифрованном слое воркера и без ключа
  // недоступен — дальше этой строки старт не идёт, пока код не введён.
  installPasscodeListener(smp, {
    lock: () => PasscodeLockScreenController.lock(),
    unlock: () => PasscodeLockScreenController.unlock(),
  })
  listenServiceWorkerHello()
  await PasscodeLockScreenController.waitForUnlock(async () => {
    // Экран блокировки рисуется ДО приложения, а тему ставило только оно
    // (React-эффект `useThemeToggle`) — под замком выходил голый белый экран без
    // переменных. tweb применяет тему здесь же (index.ts:454-456: настройки +
    // `themeController.setThemeListener()`); наши настройки уже подняты стором из
    // открытого `tg-settings` (не секрет — у tweb `settings` тоже в открытом
    // `commonStateStorage`).
    setThemeListener(() => useSettingsStore.getState().themeChoice)
    // tweb index.ts:458-459 — фон приложения ставится до экрана блокировки:
    // экран лишь накрывает его своей карточкой (и своим `<ChatBackground>` на
    // десктопе, `passcodeLock/background.solid.tsx`).
    appChatBackground.attach()
    void appChatBackground.setBackground({ transition: 'instant' })
    // экрану блокировки нужны строки — язык из кэша владельца, без сети
    // (tweb index.ts:461-462)
    setDocumentLangPackProperties(await I18n.getCacheLangPackAndApply())
  })
  // SW держит состояние кода только в памяти — сообщаем его на каждом старте
  // (tweb apiManagerProxy.ts:767 `sendPasscodeStateToServiceWorker`).
  void sendPasscodeStateToServiceWorker()

  // #1 — критические запросы стартуют до рендера: к моменту mount ответ уже летит.
  // me переиспользуется в useAuthGate (через bootData) — без второго round-trip
  // me().
  const me: Promise<PeerProfile | null> = managers.auth.me()

  // #2 — offline-first State + словарь языка + наличие токена: всё до первого
  // кадра, чтобы сразу показать последний известный UI без мигания и решить
  // authed локально (по токену), а не по сети. persistScope до чтения State
  // стирает данные предыдущего аккаунта (мультиаккаунт), чтобы стор не поднял
  // чужой конфиг.
  //
  // State (папки/черновики/прочий конфиг) читается ОДНИМ батчем за одну транзакцию —
  // как в tweb, где `await apiManagerProxy.loadAllStates()` стоит до построения UI
  // (index.ts:455). Диалоги — свой стор: в tweb они тоже вне State.
  // resetStateCache перед чтением: persistScope мог стереть данные прошлого
  // аккаунта, и мемоизированный промис прошлого входа отдал бы чужой State.
  //
  // Скоуп по токену делает воркер (`persist.scopeToSession`): токен — его факт и
  // под код-паролем лежит только в зашифрованном слое, вкладке он не отдаётся;
  // ответ — лишь «сессия есть».
  const hasToken = await managers.persist.scopeToSession()
  setStateWriter(managers.persist)
  resetStateCache()
  // Диалоги (Task 2, перенос владения в воркер): владелец сам поднимает кэш
  // прошлой сессии и отвечает reset'ом на fillMirror() — старый двухходовый
  // префетч (managers.chats.listDialogs() + отдельная hydrateDialogsFromPersist()
  // с диска) больше не нужен, воркер делает и то, и другое за одним RPC.
  //
  // Fix (финальное ревью, Important #1): RPC стартует СТРОГО ПОСЛЕ
  // `await scopeToSession()` — по той же причине, по которой после него стоит
  // чтение State. Воркерный `hydrate()` scope-гейта не имеет (persistScope в
  // `workerCore.ts::start` — один раз за жизнь воркера, на переключении аккаунта
  // его переигрывает только `scopeToSession` вкладки), поэтому запущенный раньше
  // `fillMirror()` гонялся бы с транзакцией очистки: выиграв гонку, он поднял бы
  // список ПРОШЛОГО аккаунта, boot применил бы его к зеркалу до первого рендера,
  // а дебаунс владельца уехал бы этим списком обратно на диск — уже под скоупом
  // нового. Параллельность при этом сохранена: RPC летит одновременно с чтением
  // State и словаря (оба ниже, в Promise.all).
  const dialogsOp: Promise<DialogOp | null> = fillDialogsMirror(managers)
  const [state, langPack] = await Promise.all([
    loadStateOnce(),
    // Язык — С СЕРВЕРА (задача 9), путём холодного старта оригинала (tweb
    // index.ts:487): взять пакет из КЭША владельца и применить. Кэша нет или он
    // от другого языка — под пакетом всегда лежит локальный английский
    // (`applyServerLangPack`), поэтому ЭТОТ await не может оставить вкладку ни
    // без строк, ни без кадра: в сеть он не ходит НИ ОДНОЙ веткой.
    //
    // Ждём его здесь, до первого кадра, ровно по той же причине, по какой ждём
    // State: ванильные подписи строятся `i18n()` в момент создания узла, и на
    // пустом ядре пользователь прочитал бы имя ключа. Сеть догоняет отдельно —
    // её НЕ ждём здесь (`catchUpLangPack` ниже), то же правило, что строкой
    // выше для диалогов.
    I18n.getCacheLangPackAndApply(),
  ])
  setDocumentLangPackProperties(langPack)
  // Названия месяцев и дней для чипов дат поиска (`helpers/date.ts::fillTipDates`)
  // — порт tweb index.ts:482-491 (`onLanguageApply`): сразу после применения
  // пакета старта и затем на каждую смену строк. Счётчик непрочитанных, который
  // оригинал обновляет там же, у нас пишет лента (`Chat.tsx`).
  fillLocalizedDates()
  rootScope.addEventListener('language_apply', fillLocalizedDates)
  // tweb index.ts:534 — тема и слежение за системной на обычном старте (под
  // замком подписка уже стоит, повторный вызов лишь применяет тему).
  setThemeListener(() => useSettingsStore.getState().themeChoice)
  // tweb index.ts:567-568 — фон приложения до ветвления по authState: обои
  // видны и за экраном входа (его хост прозрачен, непрозрачна только карточка).
  // Повторный `attach` идемпотентен, `setBackground` с тем же фоном —
  // пустой ход (`chatBackground.tsx:690`).
  appChatBackground.attach()
  void appChatBackground.setBackground({ transition: 'instant' })
  // Смена обоев в настройках перерисовывает фон (О-11: у tweb перерисовку
  // зовёт сама вкладка «Обои», у нас обои — ключи стора).
  watchWallPaperSettings()
  // Гидрация — SILENT: прочитанное с диска не должно поехать обратно на диск.
  setAppStateSilent(state)
  // Схема была чужой версии (или базы не было) — фиксируем текущую, чтобы
  // следующий старт прошёл версионный гейт (tweb пушит STATE_INIT при смене версии).
  // Спрашиваем именно ридер: в `state` версия уже подставлена из дефолтов, и по
  // ней «сошлось» неотличимо от «сбросили» — без этого ключ не писался бы никогда,
  // а State сбрасывался бы к дефолтам на КАЖДОМ старте.
  if (stateWasResetToDefaults()) setAppState('version', STATE_VERSION)
  migrateRecentSearchFromLocalStorage()

  // ── Открытие по ссылке — ЗДЕСЬ, до списка диалогов ──────────────────────────
  // Порт порядка холодного старта оригинала: `appImManager.construct` зовёт
  // `this.onHashChange(true)` (tweb `appImManager.ts:834`) РАНЬШЕ, чем
  // `appDialogsManager` берётся за чатлист (`appDialogsManager.ts:726`
  // `this.onStateLoaded(appState)`). Единственная гарантия, которую открытие
  // пира там ждёт, — поднятое состояние (`await apiManagerProxy.loadAllStates()`,
  // tweb `index.ts:455`), и оно у нас поднято строкой выше.
  //
  // Раньше первое применение хэша висело на эффекте смонтированного React
  // (`App.tsx` → `useUrlSync`), то есть стояло ПОСЛЕ `await dialogsOp` ниже и
  // после всего маунта дерева: ссылка на канал начинала резолвиться последней
  // из всего старта. Теперь резолв уходит в воркер здесь, параллельно
  // диалогам, — как в оригинале.
  //
  // НЕ `await`: у оригинала `onHashChange` тоже вызывается без ожидания. Ждать
  // его нельзя ни в коем случае — в ветке «канал, в котором мы не состоим» он
  // ходит в сеть за вступлением, и первый кадр повис бы на этой сети.
  //
  // Без токена — не применяем: у оригинала `bootstrapIm()` (а с ним и `onHashChange`)
  // вызывается ТОЛЬКО под авторизацией (tweb `index.ts:628`/`:641`), а у нас
  // без токена не поднят даже Shell. Этот случай (открыли ссылку, вошли по
  // OTP — `useAuthGate.login()` перезагрузки не делает) закрывает вторая точка
  // той же защёлки — монтирование `Shell`, см. `bootstrapHash`.
  if (hasToken) bootstrapHash(managers)

  // Ответ владельца применяем к витрине ДО первого рендера (см. докблок
  // applyDialogsMirror); dialogsOp был запущен выше, ещё до чтения State —
  // здесь просто дожидаемся уже летящего промиса, а не начинаем round-trip заново.
  const op = await dialogsOp
  // Fix (ревью Task 6, Important #1): `bootData` больше не несёт `dialogs` —
  // диалоги уже применены к зеркалу СТРОКОЙ НИЖЕ (applyDialogsMirror), второго
  // потребителя этого снимка (старый `useAppBootstrap → loadChats(managers,
  // prefetch).dialogs`) нет с самой правки Task 6 (диалоговая половина
  // `loadChats` снесена — см. `stores/chatsStore.ts`).
  //
  // Fix (финальное ревью, Minor #1 + Important #3): вместо мёртвого
  // `hydratedFromCache` (его никто не читал: ChatList решает по `loaded`)
  // в bootData уезжает промис СЕТЕВОГО догона — на нём висит сид презенса в
  // `useAppBootstrap`, см. докблок `applyDialogsMirror`. Сам догон НЕ ждём:
  // рендер не должен упираться в сеть.
  const dialogsReady = applyDialogsMirror(op, managers)
  setBootData({ me, dialogsReady, hasToken })

  // Смена языка в СОСЕДНЕЙ вкладке (порт tweb index.ts:519-521). Выбор делают в
  // одной вкладке, а `localStorage` соседи перечитывают только на перезагрузке —
  // без этой подписки открытая рядом вкладка осталась бы на прежнем языке до F5.
  // Своё же событие сюда тоже приходит (шина шлёт и локально), поэтому сверка:
  // язык уже применён, второй заход — лишний поход в сеть.
  rootScope.addEventListener('language_change', (langCode) => {
    if (langCode !== I18n.getLastRequestedLangCode()) void I18n.getLangPackAndApply(langCode)
  })

  // Свежий пакет с СЕРВЕРА — ПОСЛЕ первого кадра и НЕ в `await` (порт tweb
  // index.ts:512-517, где сетевой добор стоит ровно там же — после
  // `getCacheLangPackAndApply`). Разбор веток — `lib/langPack.ts::catchUpLangPack`.
  //
  // Ждать его здесь было бы нельзя даже «одним запросом»: `RestClient` не знает
  // ни таймаута, ни `AbortSignal` (`core/net/restClient.ts`), и на ВИСЯЩЕЙ сети
  // (не отказе) вкладка осталась бы без единого кадра до таймаута браузера.
  // Строки к этому моменту уже применены, ждать нечего.
  void catchUpLangPack(langPack)

  // Предложение языка по браузеру — ПОСЛЕ первого кадра и НЕ в `await`: оно
  // ходит в сеть за списком языков сервера, и отказ сети не должен задерживать
  // старт (разбор — `lib/langPack.ts::suggestBrowserLangCode`). Догнав, оно
  // видно без перезагрузки: узлы `.i18n` перерисовывает `applyLangPack`.
  void suggestBrowserLangCode()

  return { managers }
}
