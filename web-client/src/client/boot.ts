// Холодный старт до развилки «вход / мессенджер» (тело tweb `index.ts:417-612`,
// развилка и сам вызов — `src/index.ts`): регистрируем SW, поднимаем воркер, СРАЗУ
// запускаем критические RPC (me + список диалогов), готовим всё, что нужно до
// первого кадра — offline-first кэш чатов и активный словарь — и отдаём managers
// и признак сессии. Всё, что можно, делается параллельно.
import { startClient, type Managers } from './bootstrap'
import { installBridgeHandoff } from './dnpBridgeHandoff'
import { initPwaInstall } from '../core/pwa'
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
import PopupElement from '@components/popups/indexTsx.solid'
import { installPasscodeListener } from './passcodeClient'
import { installTabState } from './tabState'
import { listenServiceWorkerHello, sendPasscodeStateToServiceWorker } from './passcodeServiceWorker'
import { preventCrossTabDynamicImportDeadlock } from '../core/preventDeadlock'
import { useChatsStore } from '../stores/chatsStore'
import type { DialogOp } from '../core/dialogs/dialogOps'
import type { PeerProfile } from '../core/managers/authManager'
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
 * `appDialogsManager.start()`; кадры, случившиеся раньше её подписки, никто не
 * буферизует, см. web-client/CLAUDE.md «Владение фактами»).
 *
 * `applyDialogOps` здесь — allow-listed исключение из «пишет только проектор»
 * (см. stores/noDuplicateDialogs.test.ts, как и у сброса зеркала на выходе):
 * это тот же метод и тот же единственный вход зеркала, что и у storeProjection,
 * просто вызванный отсюда до того, как подписка на rt:dialog_op вообще
 * поднята — не второй вывод факта.
 *
 * Сети здесь НЕТ — старт списка как у tweb `dialogsStorage.getDialogs`
 * (lib/storages/dialogs.ts:1903-1914): страницу отдаёт кэш, если его хватает
 * на страницу или выборка уже загружена целиком, иначе ОДИН запрос — и решает
 * это сам список (`autonomousDialogList/base.ts::loadDialogsInner` →
 * `dialogsManager.getDialogs`), а не boot. Прежний безусловный сетевой догон
 * (`refresh()`) приходил вторым `reset` поверх кэша и перетасовывал уже
 * нарисованный список; всё, что случилось с прошлой сессии, догоняет журнал
 * апдейтов (`updates.getDifference` от сохранённого курсора).
 */
export function applyDialogsMirror(op: DialogOp | null): void {
  if (op) useChatsStore.getState().applyDialogOps([op])
}

/**
 * Порт tweb `index.ts:391-400` — направление интерфейса по языку применённого
 * пакета: `dir` корня и флаг `I18n.setRTL`, по которому зеркалят ось ползунки
 * (`components/rangeSelector.ts`, `rangeSelectorTsx.solid.tsx`). RTL у tweb
 * включает только `ar`: ветка `fa` выключена в оригинале (`&& IS_BETA && false`)
 * и сюда не перенесена. Зовётся раз на старт, как и там (:462/:570) — смена
 * языка без перезагрузки направление не меняет.
 */
/** tweb `index.ts:500-503` — строка `.is-first-unread:before` (`_chatBubble.scss:307`). */
function setUnreadMessagesText() {
  const text = I18n.format('UnreadMessages', true)
  document.documentElement.style.setProperty('--unread-messages-text', `"${text}"`)
}

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

export async function bootstrap(): Promise<{ managers: Managers; hasToken: boolean }> {
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
  const { managers, ep, smp } = startClient()
  // Менеджеры оболочки попапов по умолчанию — у tweb `PopupElementTsx.MANAGERS =
  // rootScope.managers = managers` (appDialogsManager.ts:980); попап без пропа
  // `managers` берёт их отсюда (`popups/indexTsx.solid.tsx`, расхождение 2).
  PopupElement.MANAGERS = managers
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
  // простой вкладки — воркеру, для автоблокировки (tweb apiManagerProxy.ts:645-648)
  installTabState(smp)
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
  // me переиспользуется проверкой сессии `src/index.ts` и стартом (через bootData) — без второго round-trip
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
  // и текст границы непрочитанных (`--unread-messages-text`, tweb index.ts:500-503)
  // — порт tweb index.ts:505-515 (`onLanguageApply`): сразу после применения
  // пакета старта и затем на каждую смену строк.
  const onLanguageApply = () => {
    fillLocalizedDates()
    setUnreadMessagesText()
  }
  onLanguageApply()
  rootScope.addEventListener('language_apply', onLanguageApply)
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

  // Открытие по ссылке (хэш) — не здесь: у оригинала его первое применение
  // зовёт `appImManager.construct` (`onHashChange(true)`, tweb
  // `appImManager.ts:998`) из `appDialogsManager.start()` → `bootstrapIm()`.

  // Ответ владельца применяем к витрине ДО первого рендера (см. докблок
  // applyDialogsMirror); dialogsOp был запущен выше, ещё до чтения State —
  // здесь просто дожидаемся уже летящего промиса, а не начинаем round-trip заново.
  const op = await dialogsOp
  applyDialogsMirror(op)
  setBootData({ me, hasToken })

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

  return { managers, hasToken }
}
