// src/components/connectionStatus.test.ts
// Автомат состояния соединения — порт tweb `connectionStatus.ts`.
//
// Поле поиска здесь НЕ фейк: тесты рендерят настоящий `InputSearch` и берут его
// `statusRef`. Иначе пришлось бы продублировать в фейке ранний выход
// `setPlaceholder` по ключу (`InputSearch.tsx:151`), от которого зависит вся
// механика отсчёта, — и дубль разъехался бы с оригиналом молча.
import { createElement, createRef, useLayoutEffect, useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type ConnState } from '../core/realtime/events'
// глубокий путь, а не индекс: тесту нужна ещё и длительность кросс-фейда
import InputSearch, { CONNECTION_ANIMATION_DURATION, type InputSearchStatus } from '../shared/ui/InputSearch/InputSearch'
import ConnectionStatusComponent from './connectionStatus'
import ruStrings from '../i18n/dict.ru'
import lang from '@/lang'
import { useI18nStore } from '../i18n'
import type { Managers } from '../client/bootstrap'

// Кадр rAF у фейковых таймеров vitest — 16 мс (проверено отдельно: на 15 мс
// колбэк ещё не бежит, на 16 — бежит).
const FRAME = 16

type Status = { state: ConnState; retryAt?: number; syncing: boolean }

const live: ConnectionStatusComponent[] = []

function setup(initial: Status) {
  const status: Status = { ...initial }
  const getStatus = vi.fn(async () => ({ ...status }))
  const managers = { realtime: { getStatus } } as unknown as Managers

  const statusRef = createRef<InputSearchStatus>()
  render(createElement(InputSearch, { value: '', onChange: () => {}, statusRef }))
  const root = document.querySelector<HTMLElement>('.input-search')!

  const component = new ConnectionStatusComponent()
  live.push(component)
  act(() => component.construct(managers, statusRef.current!))

  return {
    component,
    getStatus,
    root,
    /** Меняет то, что вернёт СЛЕДУЮЩИЙ pull (воркер ушёл в другое состояние). */
    set(next: Partial<Status>) { Object.assign(status, next) },
    /** Плейсхолдер, который сейчас виден (уходящий помечен `is-hiding`). */
    text() {
      const visible = [...root.querySelectorAll<HTMLElement>('.input-search-placeholder')]
        .filter((n) => !n.classList.contains('is-hiding'))
      return visible.length ? visible[visible.length - 1].textContent : null
    },
    isLoading: () => root.classList.contains('is-connecting'),
    /** rAF + отложенный на CHANGE_STATE_DELAY показ. */
    flushShow() {
      act(() => { vi.advanceTimersByTime(FRAME) })
      act(() => { vi.advanceTimersByTime(ConnectionStatusComponent.CHANGE_STATE_DELAY) })
    },
    flushFrame() { act(() => { vi.advanceTimersByTime(FRAME) }) },
  }
}

/** Уведомление «что-то изменилось». Payload намеренно врёт — его никто не читает. */
async function notifyState(payload: { state: ConnState; retryAt?: number } = { state: 'ready' }) {
  await act(async () => { rootScope.dispatchEventSingle(RT.state, payload) })
}

async function notifySyncStart() {
  await act(async () => { rootScope.dispatchEventSingle(RT.stateSynchronizing, null) })
}

async function notifySyncEnd() {
  await act(async () => { rootScope.dispatchEventSingle(RT.stateSynchronized, null) })
}

/** Довести автомат до «соединение уже было» (взводит липкий hadConnect). */
async function haveConnected(h: ReturnType<typeof setup>) {
  h.set({ state: 'ready', syncing: false })
  await notifyState()
  h.flushShow()
}

/** Так же, как `loadLang`: подменяет `t` догруженным словарём. */
// Словарь языка — символические ключи; под ним, как и в приложении, лежит английский
// источник: непереведённый ключ обязан показать английский текст, а не своё имя.
const ru = Object.fromEntries(ruStrings.flatMap((s) => (s._ === 'langPackString' ? [[s.key, s.value]] : [])))
const switchToRussian = () => act(() => {
  useI18nStore.setState({ lang: 'ru', t: (key) => ru[key] ?? (lang as unknown as Record<string, string>)[key] ?? key })
})

let englishT: I18nSnapshot
type I18nSnapshot = { lang: ReturnType<typeof useI18nStore.getState>['lang']; t: ReturnType<typeof useI18nStore.getState>['t'] }

beforeEach(() => {
  vi.useFakeTimers()
  const { lang, t } = useI18nStore.getState()
  englishT = { lang, t }
})

afterEach(() => {
  for (const component of live.splice(0)) component.destroy()
  cleanup()
  useI18nStore.setState(englishT)
  vi.useRealTimers()
})

describe('ConnectionStatusComponent — ветки автомата (tweb :144-179)', () => {
  it('construct ставит «Search» сразу (tweb :45)', () => {
    const h = setup({ state: 'ready', syncing: false })
    expect(h.text()).toBe('Search')
    expect(h.isLoading()).toBe(false)
  })

  it('соединения ещё не было → «Waiting for network...» (tweb :173)', async () => {
    const h = setup({ state: 'connecting', syncing: false })
    await notifyState()
    h.flushShow()
    expect(h.text()).toBe('Waiting for network...')
    expect(h.isLoading()).toBe(true)
  })

  it('соединение было, retryAt нет → «Reconnecting...» (tweb :170)', async () => {
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    h.set({ state: 'reconnecting', retryAt: undefined })
    await notifyState()
    h.flushShow()
    expect(h.text()).toBe('Reconnecting...')
  })

  it('соединение было, retryAt есть → «Reconnect in %ds» с живым отсчётом (tweb :150-167)', async () => {
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    h.set({ state: 'reconnecting', retryAt: Date.now() + 5000 })
    await notifyState()
    h.flushShow()
    expect(h.text()).toBe('Reconnect in 5s')

    // отсчёт живой: секунды мутируются в самом узле, мимо setPlaceholder
    act(() => { vi.advanceTimersByTime(2000) })
    expect(h.text()).toBe('Reconnect in 3s')

    // …и гаснет сам, когда retryAt прошёл (tweb :156-158)
    act(() => { vi.advanceTimersByTime(4000) })
    expect(h.text()).toBe('Reconnect in 0s')
  })

  it('соединение есть, идёт синхронизация → «Updating...» (tweb :176)', async () => {
    const h = setup({ state: 'ready', syncing: false })
    h.set({ syncing: true })
    await notifySyncStart()
    h.flushShow()
    expect(h.text()).toBe('Updating...')
    expect(h.isLoading()).toBe(true)
  })

  it('соединение есть, синхронизация кончилась → «Search» и индикатор снят (tweb :178)', async () => {
    const h = setup({ state: 'ready', syncing: true })
    await notifySyncStart()
    h.flushShow()
    expect(h.text()).toBe('Updating...')

    h.set({ syncing: false })
    await notifySyncEnd()
    // индикатор уже виден → применяется сразу, без CHANGE_STATE_DELAY (tweb :200-201)
    h.flushFrame()
    expect(h.text()).toBe('Search')
    // `is-connecting` снимается не мгновенно, а по окончании обратного перехода
    // (setTransition, tweb singleTransition.ts:56-60) — до тех пор isLoading() ещё true
    act(() => { vi.advanceTimersByTime(CONNECTION_ANIMATION_DURATION) })
    expect(h.isLoading()).toBe(false)
  })
})

describe('ConnectionStatusComponent — вход только через pull (tweb :47-51, :87-91)', () => {
  it('payload уведомления не читается: показывается то, что вернул getStatus()', async () => {
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    // воркер уже в reconnecting, а в payload — заведомая ложь
    h.set({ state: 'reconnecting', retryAt: undefined })
    await notifyState({ state: 'ready', retryAt: undefined })
    h.flushShow()
    expect(h.text()).toBe('Reconnecting...')
  })

  it('иммунность к потере уведомлений: ни одного RT.*, но стартовый pull по INITIAL_DELAY даёт верный текст (tweb :66-69)', async () => {
    // воркер сменил состояние ДО монтирования и подписки — событий не будет вовсе
    const h = setup({ state: 'connecting', syncing: false })
    expect(h.text()).toBe('Search')

    await act(async () => { vi.advanceTimersByTime(ConnectionStatusComponent.INITIAL_DELAY) })
    expect(h.getStatus).toHaveBeenCalledTimes(1)
    h.flushShow()
    expect(h.text()).toBe('Waiting for network...')
  })

  it('первое уведомление снимает стартовый таймер — второго pull не будет (tweb :96-99)', async () => {
    const h = setup({ state: 'connecting', syncing: false })
    await notifyState()
    expect(h.getStatus).toHaveBeenCalledTimes(1)

    await act(async () => { vi.advanceTimersByTime(ConnectionStatusComponent.INITIAL_DELAY * 2) })
    expect(h.getStatus).toHaveBeenCalledTimes(1)
  })

  it('RT.state не дедуплицируется по значению: reconnecting(X) → reconnecting(—) → reconnecting(Y) перезапускает отсчёт', async () => {
    // реальная последовательность нашего connectionManager (:124-130):
    // отсчёт → «Переподключение» → новый отсчёт
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    h.set({ state: 'reconnecting', retryAt: Date.now() + 5000 })
    await notifyState()
    h.flushShow()
    expect(h.text()).toBe('Reconnect in 5s')

    h.set({ state: 'reconnecting', retryAt: undefined })
    await notifyState()
    h.flushFrame()
    expect(h.text()).toBe('Reconnecting...')

    h.set({ state: 'reconnecting', retryAt: Date.now() + 9000 })
    await notifyState()
    h.flushFrame()
    expect(h.text()).toBe('Reconnect in 9s')
  })
})

describe('ConnectionStatusComponent — «обновляется» из ФАКТА события (tweb :53-64)', () => {
  it('короткая синхронизация показывается, даже если pull её уже не застаёт', async () => {
    // Воркер успел начать и закончить догон быстрее, чем вернулся бы RPC:
    // getStatus() отдаёт syncing: false ВСЁ время. Вывод «обновляется» из pull
    // такую синхронизацию не показывал вовсе.
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    await notifySyncStart()
    h.flushShow()
    expect(h.text()).toBe('Updating...')
    expect(h.isLoading()).toBe(true)
  })

  it('конец синхронизации гасит спиннер, даже если pull ещё отвечает syncing: true', async () => {
    // Инверсия ответов/протухший снимок: значение из pull не должно перебивать
    // факт события — иначе спиннер залипает до следующего события.
    const h = setup({ state: 'ready', syncing: true })
    await notifySyncStart()
    h.flushShow()
    expect(h.text()).toBe('Updating...')

    await notifySyncEnd()
    h.flushFrame()
    expect(h.text()).toBe('Search')
  })

  it('события синхронизации НЕ дёргают pull (значение берётся из факта)', async () => {
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)
    h.getStatus.mockClear()

    await notifySyncStart()
    await notifySyncEnd()
    expect(h.getStatus).not.toHaveBeenCalled()
  })

  it('вкладка, смонтированная в СЕРЕДИНЕ догона, узнаёт про него стартовым pull', async () => {
    // Наше сохранённое расширение поверх tweb: событие начала догона уехало до
    // подписки (SuperMessagePort кадры не буферизует), и знать о нём можно
    // только из ответа владельца.
    const h = setup({ state: 'ready', syncing: true })
    await act(async () => { vi.advanceTimersByTime(ConnectionStatusComponent.INITIAL_DELAY) })
    h.flushShow()
    expect(h.text()).toBe('Updating...')
  })

  it('…но после первого же события синхронизации pull её значение больше не трогает', async () => {
    const h = setup({ state: 'ready', syncing: true })
    await notifySyncEnd() // догон кончился; снимок воркера ещё протухший
    h.flushShow()
    expect(h.text()).toBe('Search')

    await notifyState() // pull вернёт syncing: true — «воскресить» спиннер не должен
    h.flushFrame()
    expect(h.text()).toBe('Search')
  })
})

describe('ConnectionStatusComponent — липкий hadConnect (tweb :108-110)', () => {
  it('ready → offline даёт «Reconnecting...», а не «Waiting for network...»', async () => {
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    // протухший токен в середине сессии: connectionManager уходит в offline
    h.set({ state: 'offline', retryAt: undefined })
    await notifyState()
    h.flushShow()
    expect(h.text()).toBe('Reconnecting...')
  })
})

describe('ConnectionStatusComponent — механика показа (tweb :182-205)', () => {
  it('короткий разрыв (< CHANGE_STATE_DELAY) индикатор не показывает', async () => {
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    h.set({ state: 'reconnecting', retryAt: undefined })
    await notifyState()
    h.flushFrame()
    act(() => { vi.advanceTimersByTime(ConnectionStatusComponent.CHANGE_STATE_DELAY - 100) })
    expect(h.isLoading()).toBe(false)
    expect(h.text()).toBe('Search')

    // Связь вернулась раньше, чем истёк порог. Отложенный показ должен быть
    // СНЯТ, а не просто перекрыт следующим: его срок наступает раньше нового,
    // иначе на 300 мс мелькнёт «Reconnecting...» (tweb :185).
    h.set({ state: 'ready' })
    await notifyState()
    h.flushFrame()
    act(() => { vi.advanceTimersByTime(150) })
    expect(h.text()).toBe('Search')

    act(() => { vi.advanceTimersByTime(ConnectionStatusComponent.CHANGE_STATE_DELAY) })
    expect(h.isLoading()).toBe(false)
    expect(h.text()).toBe('Search')
  })

  it('видимость читается в кадре, а не при вызове setState (tweb :187)', async () => {
    // Окно, в котором это различимо, одно: отложенный показ успевает сработать
    // МЕЖДУ вызовом setState и его кадром. Тогда к моменту кадра индикатор уже
    // виден, и следующее состояние обязано примениться сразу; чтение видимости,
    // вынесенное перед requestAnimationFrame, увидело бы ещё скрытый индикатор
    // и отложило бы текст ещё на 400 мс.
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    h.set({ state: 'reconnecting', retryAt: undefined })
    await notifyState()
    h.flushFrame() // кадр отработал, показ отложен на 400 мс

    // за 11 мс до срабатывания отложенного показа: его кадр придёт уже ПОСЛЕ
    act(() => { vi.advanceTimersByTime(ConnectionStatusComponent.CHANGE_STATE_DELAY - 11) })
    expect(h.isLoading()).toBe(false)

    h.set({ state: 'ready', syncing: true })
    await notifyState()
    h.flushFrame()

    expect(h.isLoading()).toBe(true)
    expect(h.text()).toBe('Updating...')
  })

  it('длинный разрыв (>= CHANGE_STATE_DELAY) показывает спиннер и текст', async () => {
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    h.set({ state: 'reconnecting', retryAt: undefined })
    await notifyState()
    h.flushFrame()
    act(() => { vi.advanceTimersByTime(ConnectionStatusComponent.CHANGE_STATE_DELAY) })
    expect(h.isLoading()).toBe(true)
    expect(h.text()).toBe('Reconnecting...')
    expect(h.root.querySelector('.preloader-container')).toBeTruthy()
  })
})

describe('ConnectionStatusComponent — destroy снимает всё, чем владеет', () => {
  it('снимает три подписки', async () => {
    const h = setup({ state: 'ready', syncing: false })
    h.component.destroy()

    await notifyState()
    expect(h.getStatus).not.toHaveBeenCalled()

    // Пара синхронизации pull не дёргает — её отписку видно по тому, что текст
    // не меняется (иначе размонтированный автомат продолжал бы писать в поле).
    await notifySyncStart()
    h.flushShow()
    expect(h.text()).toBe('Search')
  })

  it('снимает стартовый таймер INITIAL_DELAY', async () => {
    const h = setup({ state: 'connecting', syncing: false })
    h.component.destroy()

    await act(async () => { vi.advanceTimersByTime(ConnectionStatusComponent.INITIAL_DELAY) })
    expect(h.getStatus).not.toHaveBeenCalled()
  })

  it('отменяет запланированный rAF — и висит он ровно один (схлопывание, tweb :182)', async () => {
    const h = setup({ state: 'ready', syncing: false })
    h.set({ state: 'connecting' })
    // ДВА уведомления подряд, ни одного кадра между ними: если setState не
    // отменяет предыдущий rAF, их накопится два, а destroy знает только про
    // последний — первый переживёт размонтирование и покажет статус
    await notifyState()
    await notifyState()
    h.component.destroy()

    h.flushShow()
    expect(h.text()).toBe('Search')
    expect(h.isLoading()).toBe(false)
  })

  it('отменяет отложенный на CHANGE_STATE_DELAY показ', async () => {
    const h = setup({ state: 'ready', syncing: false })
    h.set({ state: 'connecting' })
    await notifyState()
    h.flushFrame() // rAF отработал, показ отложен таймером
    h.component.destroy()

    act(() => { vi.advanceTimersByTime(ConnectionStatusComponent.CHANGE_STATE_DELAY) })
    expect(h.text()).toBe('Search')
    expect(h.isLoading()).toBe(false)
  })

  it('снимает интервал отсчёта — секунды больше не тикают', async () => {
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    h.set({ state: 'reconnecting', retryAt: Date.now() + 5000 })
    await notifyState()
    h.flushShow()
    expect(h.text()).toBe('Reconnect in 5s')

    h.component.destroy()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(h.text()).toBe('Reconnect in 5s')
  })

  it('гасит уже летящий pull: ответ, пришедший после destroy, ничего не показывает', async () => {
    const h = setup({ state: 'ready', syncing: false })
    h.set({ state: 'connecting' })

    // уведомление пришло, RPC ушёл — и вкладку размонтировали, не дождавшись ответа
    act(() => { rootScope.dispatchEventSingle(RT.state, { state: 'connecting' }) })
    h.component.destroy()
    await act(async () => {})

    h.flushShow()
    expect(h.text()).toBe('Search')
    expect(h.isLoading()).toBe(false)
  })
})

describe('ConnectionStatusComponent — смена языка', () => {
  // У tweb живые `.i18n`-узлы обновляет сам langPack (:328-335); у нас такого
  // механизма нет, и без подписки автомата плейсхолдер застревал бы на прежнем
  // языке до следующей смены состояния соединения — то есть до перезагрузки.
  it('«Search» превращается в «Поиск» без смены состояния соединения', () => {
    const h = setup({ state: 'ready', syncing: false })
    expect(h.text()).toBe('Search')

    switchToRussian()
    expect(h.text()).toBe('Поиск')
  })

  it('перерисовывается текущее состояние, а не «Search»', async () => {
    const h = setup({ state: 'connecting', syncing: false })
    await notifyState()
    h.flushShow()
    expect(h.text()).toBe('Waiting for network...')

    switchToRussian()
    expect(h.text()).toBe('Ожидание сети...')
  })

  it('отсчёт переживает смену языка: тот же живой span продолжает тикать', async () => {
    const h = setup({ state: 'ready', syncing: false })
    await haveConnected(h)

    h.set({ state: 'reconnecting', retryAt: Date.now() + 5000 })
    await notifyState()
    h.flushShow()
    expect(h.text()).toBe('Reconnect in 5s')

    switchToRussian()
    expect(h.text()).toBe('Переподключение через 5 с')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(h.text()).toBe('Переподключение через 3 с')
  })

  it('после destroy смена языка ничего не трогает', () => {
    const h = setup({ state: 'ready', syncing: false })
    h.component.destroy()

    switchToRussian()
    expect(h.text()).toBe('Search')
  })
})

describe('ConnectionStatusComponent — монтирование хостом', () => {
  // Sidebar конструирует автомат из своего useEffect, а хэндл `statusRef`
  // выставляет useImperativeHandle внутри InputSearch. Проводку самого Sidebar
  // тестом не поднять (см. комментарий у неё), но её единственная нетривиальная
  // предпосылка — порядок эффектов — проверяема на таком же хосте.
  it('к моменту эффекта родителя statusRef уже заполнен, автомат монтируется и размонтируется', () => {
    const getStatus = vi.fn(async () => ({ state: 'ready' as ConnState, retryAt: undefined, syncing: false }))
    const managers = { realtime: { getStatus } } as unknown as Managers
    let seen: InputSearchStatus | null = null

    function Host() {
      const statusRef = useRef<InputSearchStatus>(null)
      // слой раскладки — как в Sidebar (плейсхолдер должен быть до отрисовки)
      useLayoutEffect(() => {
        seen = statusRef.current
        if (!statusRef.current) return
        const component = new ConnectionStatusComponent()
        component.construct(managers, statusRef.current)
        return () => component.destroy()
      }, [])
      return createElement(InputSearch, { value: '', onChange: () => {}, statusRef })
    }

    const view = render(createElement(Host))
    expect(seen).not.toBeNull()
    const root = document.querySelector<HTMLElement>('.input-search')!
    expect(root.querySelector('.input-search-placeholder')?.textContent).toBe('Search')

    // размонтирование хоста снимает подписки автомата
    view.unmount()
    act(() => { rootScope.dispatchEventSingle(RT.state, { state: 'ready' }) })
    expect(getStatus).not.toHaveBeenCalled()
  })
})

describe('ConnectionStatusComponent — ключи словаря', () => {
  // Опечатка в ключе не роняет ни сборку, ни тесты веток (t() отдаёт сам ключ,
  // и англичанину всё равно) — молча теряется весь русский перевод индикатора.
  it('все четыре ключа автомата есть в dict.ru', () => {
    for (const key of ['Search', 'ConnectionStatus.ReconnectInPlain', 'ConnectionStatus.Reconnecting', 'ConnectionStatus.Waiting', 'Updating']) {
      expect(ru[key], key).toBeTruthy()
    }
  })

  it('строка отсчёта несёт подстановку %d — иначе секунды некуда вставить', () => {
    expect(ru['ConnectionStatus.ReconnectInPlain']).toContain('%d')
  })
})
