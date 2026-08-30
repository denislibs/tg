// src/components/connectionStatus.ts
//
// Порт tweb `src/components/connectionStatus.ts` — конечный автомат состояния
// соединения, который ведёт плейсхолдер и спиннер поля поиска сайдбара.
//
// Форма — императивный класс с `construct()`, как в оригинале, а не React-хук:
// всё, чем автомат владеет (rAF, два таймера, интервал отсчёта, живой `<span>`
// с секундами и узлы плейсхолдера, которые `InputSearch` добавляет мимо React),
// живёт вне рендера. Хост — `Sidebar`: монтирует и уничтожает.
//
// НЕ портировано из оригинала (с причинами):
//   * `singleInstance.deactivatedReason` (:139-141) — у нас нет механизма
//     дезактивации лишней вкладки: порты закрытых вкладок снимаются Web Locks,
//     «протухшая» вкладка не живёт (см. web-client/CLAUDE.md, `attachLock`).
//   * `TEST_DBLCLICK` (:14, :71-84), `HAVE_RECONNECT_BUTTON` (:15, :163-168),
//     `NO_STATUS` (:13) — выключенные отладочные флаги, у нас это мёртвый код.
//   * `getA` / ссылка `force-reconnect` (:126-136) — нужна только ветке
//     `HAVE_RECONNECT_BUTTON` и закомментированной ветке `timedOut`.
//   * `forceGetDifference` (:105) — у нас догон пропущенного делает syncEngine
//     воркера сам при переподключении (`onSyncStart`/`onSyncEnd`), витрине
//     дёргать его нечем и незачем.
//   * `baseDcId` и карта статусов по DC (:89, :101) — мультидатацентровости нет,
//     `realtime.getStatus()` отдаёт плоский объект (разбор — докблок `getStatus`
//     в `core/realtime/realtime.ts`).
//   * ветка `timedOut` (:112, :145-148) — у нас нет такого состояния
//     (`ConnState` = connecting | ready | reconnecting | offline). Текст у неё
//     всё равно тот же, что у `updating` ниже ('Updating'), так что видимого
//     поведения ветка не добавляет — см. комментарий в `setState`.
//   * `ANIMATION_DURATION` (:20) — живёт в `InputSearch`
//     (`CONNECTION_ANIMATION_DURATION`), потому что пользуется ею только он.
//   * `logger`/`DEBUG` — у нас нет вендорного логгера tweb.

import type { LangPackKey } from '@/lang'
import rootScope from '@lib/rootScope'
import { getMiddleware } from '@helpers/middleware'
import { RT } from '../core/realtime/events'
import { useI18nStore } from '../i18n'
import type { Managers } from '../client/bootstrap'
import type { InputSearchStatus } from '../shared/ui/InputSearch'

export default class ConnectionStatusComponent {
  /** tweb :18 */
  public static CHANGE_STATE_DELAY = 400
  /** tweb :19 */
  public static INITIAL_DELAY = 2000

  private hadConnect = false
  private retryAt: number | undefined
  private connecting = false
  private updating = false
  /** Видели ли хоть одно RT.stateSynchronizing/Synchronized — см. гейт в `setConnectionStatus`. */
  private sawSyncEvent = false

  private managers!: Managers
  private inputSearch!: InputSearchStatus

  private setFirstConnectionTimeout = 0
  private setStateTimeout = 0
  private rAF = 0
  /** Последнее, что реально показано, — чтобы перерисовать его на смене языка. */
  private lastText: { key: LangPackKey; timerSpan?: HTMLElement } | undefined
  private unsubscribeLang: (() => void) | undefined
  // Живые интервалы отсчёта — только ради `destroy()`, см. комментарий там же.
  private timerIntervals = new Set<number>()
  private middlewareHelper = getMiddleware()

  public construct(managers: Managers, inputSearch: InputSearchStatus) {
    this.managers = managers
    this.inputSearch = inputSearch
    this.setStatusText('Search') // tweb :45

    // tweb :47-64 — три подписки, и обработчики у них РАЗНЫЕ.
    //
    // `connection_status_change` (:47-51) игнорирует payload и зовёт pull:
    // значение состояния соединения всегда приходит запросом (:87-91). Это у нас
    // 1:1 — см. докблок `getStatus` в `core/realtime/realtime.ts`.
    //
    // А `state_synchronizing`/`state_synchronized` (:53-64) пишут `this.updating`
    // прямо из ФАКТА события и зовут `setState()` синхронно — никакого pull.
    // Раньше и эта пара шла через pull (`syncing` из `getStatus()`), и это
    // ломалось двумя способами, оба недостижимы для фактовой ветки:
    //   • короткая синхронизация (началась и кончилась быстрее, чем вернулся
    //     RPC) не показывалась вовсе — оба pull'а возвращали `syncing: false`;
    //   • при инверсии ответов (pull «начала» вернулся ПОЗЖЕ pull'а «конца»)
    //     побеждало протухшее `true`, и спиннер залипал до следующего события.
    rootScope.addEventListener(RT.state, this.setConnectionStatus)
    rootScope.addEventListener(RT.stateSynchronizing, this.onSyncStart)
    rootScope.addEventListener(RT.stateSynchronized, this.onSyncEnd)

    // Смена языка. НЕ порт, а узкое отступление, и это надо читать именно так: у
    // tweb перерисовка живых узлов — обязанность самой подсистемы i18n
    // (`langPack.ts:328-335` обходит все `.i18n` и зовёт `instance.update()`),
    // автомат про язык не знает вовсе. Общий механизм у нас отсутствует (наш
    // i18n отдаёт строку, а не живой элемент), а заводить его — работа заметно
    // шире этой задачи; пока свой узел обновляет автомат.
    // Сигнал — смена самой `t`, а не `lang`: `setLang` меняет код языка сразу, а
    // `t` подменяется позже, когда догрузится чанк словаря (`i18n/index.tsx`
    // loadLang), и реагировать надо на второе. Применяется сразу, мимо
    // rAF/CHANGE_STATE_DELAY: состояние соединения не менялось, показывать
    // нечего нового — перерисовывается тот же текст. `timerSpan` передаётся
    // ТОТ ЖЕ: узел просто переезжает в новый плейсхолдер и продолжает тикать от
    // своего интервала.
    this.unsubscribeLang = useI18nStore.subscribe((state, prev) => {
      if (state.t === prev.t || !this.lastText) return
      this.setStatusText(this.lastText.key, this.lastText.timerSpan)
    })

    // tweb :66-69 — стартовый pull. Вкладка, смонтировавшаяся после единственного
    // перехода в 'reconnecting' (backoff до 30 с), не увидит ни одного
    // уведомления; без этого таймера она осталась бы с «Поиск» навсегда.
    this.setFirstConnectionTimeout = window.setTimeout(
      this.setConnectionStatus,
      ConnectionStatusComponent.INITIAL_DELAY,
    )
  }

  /**
   * Снятие всего, чем владеет автомат. У tweb деструктора нет вовсе — его
   * компонент живёт со страницей; у нас его размонтирует React, так что это
   * расширение поверх порта, а не его часть.
   */
  public destroy() {
    // Гасит уже летящий pull: RPC мог уйти до размонтирования и вернуться после.
    this.middlewareHelper.destroy()
    rootScope.removeEventListener(RT.state, this.setConnectionStatus)
    rootScope.removeEventListener(RT.stateSynchronizing, this.onSyncStart)
    rootScope.removeEventListener(RT.stateSynchronized, this.onSyncEnd)
    this.unsubscribeLang?.()
    if (this.setFirstConnectionTimeout) clearTimeout(this.setFirstConnectionTimeout)
    if (this.setStateTimeout) clearTimeout(this.setStateTimeout)
    if (this.rAF) window.cancelAnimationFrame(this.rAF)
    // Интервалы отсчёта по ходу работы НЕ снимаются (как и у tweb :157 — каждый
    // гаснет сам по своему `retryAt`), и это не недосмотр: `setPlaceholder`
    // делает ранний выход на повторе того же ключа (`InputSearch.tsx:151`, порт
    // `inputSearch.ts:176-177`), поэтому при двух 'reconnecting' подряд старый
    // `<span>` остаётся видимым — снятие его интервала заморозило бы живой
    // отсчёт. А вот пережить размонтирование они не должны.
    for (const interval of this.timerIntervals) clearInterval(interval)
  }

  /** tweb :53-57 — `updating` из факта события, `setState()` сразу. */
  private onSyncStart = () => {
    this.sawSyncEvent = true
    this.updating = true
    this.setState()
  }

  /** tweb :59-64 — то же на конец синхронизации. */
  private onSyncEnd = () => {
    this.sawSyncEvent = true
    this.updating = false
    this.setState()
  }

  // tweb :87-118. Значение всегда берётся отсюда, из pull (:88-91 тянет
  // `getConnectionStatus()`), а не из payload события.
  private setConnectionStatus = () => {
    const middleware = this.middlewareHelper.get()
    void this.managers.realtime.getStatus().then(({ state, retryAt, syncing }) => {
      if (!middleware()) return

      // tweb :96-99 — первое же уведомление снимает стартовый таймер, чтобы
      // пулла не было дважды.
      if (this.setFirstConnectionTimeout) {
        clearTimeout(this.setFirstConnectionTimeout)
        this.setFirstConnectionTimeout = 0
      }

      // tweb :102 — `online` это ровно `ConnectionStatus.Connected`; у нас 'ready'.
      const online = state === 'ready'
      // tweb :108-110 — липкий флаг, а НЕ вывод из состояния: при протухшем
      // токене в середине сессии `connect()` уходит в 'offline'
      // (`connectionManager.ts:123`), и «было ли соединение» из `ConnState` уже
      // не восстановить — получилось бы «Ожидание сети» вместо «Переподключение».
      if (online && !this.hadConnect) this.hadConnect = true
      this.connecting = !online // tweb :113
      this.retryAt = retryAt // tweb :114
      // У tweb `updating` сюда не входит вовсе (см. подписки в `construct`):
      // `getConnectionStatus()` про синхронизацию ничего не отдаёт. Наше
      // сохранённое расширение — РОВНО одно: засеять `updating` ответом pull'а,
      // пока НИ ОДНОГО события синхронизации ещё не видели. Оно закрывает дыру,
      // которой у tweb нет: подписка вешается после первого рендера, а
      // SuperMessagePort кадры не буферизует — вкладка, смонтировавшаяся в
      // середине догона, без этого сидела бы с «Поиск» до конца догона. Гейт по
      // `sawSyncEvent` и есть то, что делает расширение безопасным: инвертировать
      // факт события протухший ответ уже не может.
      if (!this.sawSyncEvent) this.updating = syncing
      this.setState() // tweb :116
    })
  }

  /**
   * Узел плейсхолдера. У tweb его строит `i18n(langPackKey, args)` внутри
   * `setPlaceholder` (`inputSearch.ts:192`); наш i18n отдаёт строку, поэтому
   * подстановка живого `<span>` с секундами в разрыв `%d` — здесь.
   */
  private wrapText(text: string, timerSpan?: HTMLElement): Node {
    const fragment = document.createDocumentFragment()
    if (!timerSpan) {
      fragment.append(text)
      return fragment
    }

    const [before, after = ''] = text.split('%d')
    fragment.append(before, timerSpan, after)
    return fragment
  }

  /**
   * Единственная точка, где текст реально попадает в поле. Запоминает свои
   * аргументы: на смене языка автомату нужно перерисовать ТО ЖЕ состояние
   * (см. подписку на i18n в `construct`).
   */
  private setStatusText = (key: LangPackKey, timerSpan?: HTMLElement) => {
    this.lastText = { key, timerSpan }
    const text = useI18nStore.getState().t(key)
    // Ключ дедупа — пара «ключ i18n + показанный текст», а у tweb это один
    // `LangPackKey` (`inputSearch.ts:176`). Расхождение вынужденное, и его
    // причина — разные подсистемы i18n, а не вкус: у tweb `i18n()` возвращает
    // живой `I18n.IntlElement`, и на смене языка `langPack.ts:328-335` сам
    // обходит все узлы `.i18n` и зовёт `instance.update()`. Наш узел класс
    // `i18n` носит, но обновлять его некому, поэтому дедуп по одному ключу
    // означал бы, что после смены языка плейсхолдер остаётся на старом до
    // следующей смены состояния соединения — в штатной работе до перезагрузки.
    // Семантика дедупа при этом та же: одинаковое показанное содержимое
    // по-прежнему не перезапускает кросс-фейд (в ветке отсчёта строка не
    // меняется — секунды живут в отдельном `<span>` и идут мимо setPlaceholder).
    this.inputSearch.setPlaceholder(`${key}\n${text}`, this.wrapText(text, timerSpan))
  }

  /** tweb :120-124 — текст ставится не сейчас, а когда дойдёт до показа. */
  private wrapSetStatusText = (key: LangPackKey, timerSpan?: HTMLElement) => {
    return () => this.setStatusText(key, timerSpan)
  }

  // tweb :138-206
  private setState = () => {
    let setText: () => void
    if (this.connecting) {
      // Ветка `timedOut` (tweb :145-148) не портирована — состояния «запрос
      // протух» у нас нет; текст у неё тот же 'Updating', что и в ветке
      // `updating` ниже, так что видимого поведения она бы не добавила.
      if (this.hadConnect) {
        // tweb :149
        if (this.retryAt !== undefined) {
          // tweb :150-161 — живой отсчёт: автомат мутирует сам этот `<span>`,
          // мимо `setPlaceholder` (иначе кросс-фейд перезапускался бы раз в секунду).
          const timerSpan = document.createElement('span')
          const retryAt = this.retryAt
          const setTime = () => {
            const now = Date.now()
            timerSpan.innerText = '' + Math.max(0, Math.round((retryAt - now) / 1000))
            if (now > retryAt) {
              clearInterval(interval)
              this.timerIntervals.delete(interval)
            }
          }
          const interval = window.setInterval(setTime, 1e3)
          this.timerIntervals.add(interval)
          setTime()

          setText = this.wrapSetStatusText('ConnectionStatus.ReconnectInPlain', timerSpan) // tweb :167
        } else {
          setText = this.wrapSetStatusText('ConnectionStatus.Reconnecting') // tweb :170
        }
      } else {
        setText = this.wrapSetStatusText('ConnectionStatus.Waiting') // tweb :173
      }
    } else if (this.updating) {
      setText = this.wrapSetStatusText('Updating') // tweb :176
    } else {
      setText = this.wrapSetStatusText('Search') // tweb :178
    }

    // tweb :182-205. Схлопывание через rAF и отмена предыдущего отложенного
    // показа — часть механики: индикатор виден → применяем сразу, не виден →
    // ждём CHANGE_STATE_DELAY, чтобы не мигать на коротких разрывах.
    if (this.rAF) window.cancelAnimationFrame(this.rAF)
    this.rAF = window.requestAnimationFrame(() => {
      this.rAF = 0
      if (this.setStateTimeout) clearTimeout(this.setStateTimeout)

      const wasVisible = this.inputSearch.isLoading()
      const cb = () => {
        setText()
        this.inputSearch.toggleLoading(this.connecting || this.updating)
        this.setStateTimeout = 0
      }

      if (wasVisible) cb()
      else this.setStateTimeout = window.setTimeout(cb, ConnectionStatusComponent.CHANGE_STATE_DELAY)
    })
  }
}
