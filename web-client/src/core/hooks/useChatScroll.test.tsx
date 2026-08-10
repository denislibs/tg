// src/core/hooks/useChatScroll.test.tsx
//
// Интеграционный тест ПОДКЛЮЧЕНИЯ useChatScroll → ScrollSaver (helpers/scrollSaver.ts).
// scrollSaver.test.ts бьёт по голому классу — он физически не может заметить, если
// бы хук перестал вызывать save()/restore() в нужных местах (см. task-3-report.md,
// «Самопроверка»). Этот файл рендерит настоящий хук через настоящий React-эффект-
// цикл и проверяет ровно точки подключения: триггер loadOlder() → save(), коммит
// нового окна → restore().
//
// happy-dom не считает layout — getBoundingClientRect/scrollHeight/clientHeight
// всегда 0/no-op. Стабы здесь живут НЕ на инстансах элементов, а на
// HTMLElement.prototype: узлы препенда рендерятся React'ом ДО того, как тест
// получает к ним JS-хендл (они появляются только после rerender), поэтому
// геометрию нужно резолвить по data-атрибуту (`data-seq`/`data-scroll-container`)
// В МОМЕНТ вызова getBoundingClientRect, а не проставлять заранее на конкретный
// узел.
//
// Задача 4 (components/scrollable.ts): триггер loadOlder() теперь идёт через
// Scrollable.onScrolledTop, а не через синхронный addEventListener этого хука —
// throttleMeasurement (scrollable.ts) откладывает измерение на SCROLL_THROTTLE
// (24мс setTimeout при поддержке overlay-скролла, иначе requestAnimationFrame).
// `flushScrollThrottle()` ждёт реальным таймером после каждого dispatchEvent,
// с запасом покрывая оба варианта — иначе два синхронных scroll-события подряд
// схлопнутся в одно измерение (onScroll видит "onScrollMeasure ещё висит" и
// выходит рано), теряя промежуточное значение scrollTop, по которому
// вычисляется lastScrollDirection.
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useChatScroll } from './useChatScroll'
import { ManagersProvider } from './useManagers'
import type { MessageWindow } from './useMessageWindow'
import type { Message } from '../models'
import Scrollable from '@components/scrollable'

async function flushScrollThrottle() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function msg(seq: number): Message {
  return {
    id: seq, chatId: 1, seq, senderId: 1, type: 'text', text: `m${seq}`,
    replyToId: null, mediaId: null, createdAt: '2026-06-24T10:00:00Z', threadRootId: null,
  }
}

function makeWin(msgs: Message[], overrides: Partial<MessageWindow> = {}): MessageWindow {
  return {
    msgs, reachedTop: false, reachedBottom: true, loadingOlder: false, loadingNewer: false,
    loading: false, loadedFromCache: false,
    loadOlder: async () => {}, loadNewer: async () => {},
    appendLocal: () => {}, applyIncoming: () => {}, applyEdit: () => {},
    jumpTo: async () => {}, reloadNewest: async () => {}, applyDelete: () => {},
    ...overrides,
  }
}

function domRect(top: number, bottom: number): DOMRect {
  return {
    top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top,
    toJSON() { return this },
  } as DOMRect
}

// Геометрия, управляемая тестом. Ключ для сообщений — seq (data-seq), для
// скролл-контейнера — фиксированный маркер data-scroll-container.
type Rect = { top: number, bottom: number }
let containerRect: Rect = { top: 0, bottom: 500 }
let containerScrollHeight = 1000
let containerClientHeight = 500
const seqRects = new Map<number, Rect>()

// Ставит дескриптор на HTMLElement.prototype и возвращает функцию, восстанавливающую
// ТОЧНОЕ исходное состояние. Важно: в happy-dom эти свойства не все живут на одном
// уровне цепочки прототипов (scrollHeight/getBoundingClientRect — собственные
// свойства Element.prototype, а не HTMLElement.prototype; clientHeight — наоборот,
// уже собственное свойство HTMLElement.prototype). Наивное «сохранили дескриптор с
// HTMLElement.prototype и восстановили его же» для унаследованных свойств даёт
// undefined и молча НЕ снимает наш override после теста — течь стаба во все
// остальные файлы того же процесса vitest. Поэтому: проверяем hadOwnProperty ИМЕННО
// на HTMLElement.prototype (куда сами кладём override), восстанавливаем либо
// сохранённым дескриптором, либо delete — возвращая цепочку к исходному наследованию
// от Element.prototype.
function patchProto(name: 'getBoundingClientRect' | 'scrollHeight' | 'clientHeight', descriptor: PropertyDescriptor): () => void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const hadOwn = Object.prototype.hasOwnProperty.call(HTMLElement.prototype, name)
  const original = hadOwn ? Object.getOwnPropertyDescriptor(HTMLElement.prototype, name) : undefined
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, ...descriptor })
  return () => {
    if (hadOwn && original) Object.defineProperty(HTMLElement.prototype, name, original)
    else delete proto[name]
  }
}

let restoreAll: (() => void)[] = []

beforeAll(() => {
  restoreAll = [
    // Промах мимо наших стабов (не data-scroll-container/data-seq) делегируется в
    // родной Element.prototype-метод напрямую через .call(this) — вызываем на месте,
    // не сохраняя голую ссылку в переменной (иначе typescript/unbound-method).
    patchProto('getBoundingClientRect', {
      value(this: HTMLElement) {
        if (this.dataset.scrollContainer != null) return domRect(containerRect.top, containerRect.bottom)
        if (this.dataset.seq != null) {
          const r = seqRects.get(Number(this.dataset.seq))
          if (r) return domRect(r.top, r.bottom)
        }
        return Element.prototype.getBoundingClientRect.call(this)
      },
    }),
    patchProto('scrollHeight', {
      get(this: HTMLElement) { return this.dataset.scrollContainer != null ? containerScrollHeight : 0 },
    }),
    patchProto('clientHeight', {
      get(this: HTMLElement) { return this.dataset.scrollContainer != null ? containerClientHeight : 0 },
    }),
  ]
})

afterAll(() => {
  for (const undo of restoreAll) undo()
})

beforeEach(() => {
  containerRect = { top: 0, bottom: 500 }
  containerScrollHeight = 1000
  containerClientHeight = 500
  seqRects.clear()
  document.body.innerHTML = ''
})

const fakeManagers = { realtime: { markRead: async () => {} } }

function Harness({ win }: { win: MessageWindow }) {
  const { scrollRef, contentRef, showScrollDown } = useChatScroll({
    numericChatId: 1, isRealChat: true, win, paddingTop: 0, unreadDividerSeq: null, unreadStickyTop: 0,
  })
  return (
    // data-show-scroll-down зеркалит состояние хука наружу — снаружи React-состояние
    // не пощупать, а тест ниже проверяет именно ЕГО (не голый scrollTop).
    <div ref={scrollRef} data-scroll-container="1" data-show-scroll-down={showScrollDown ? '1' : '0'}>
      <div ref={contentRef}>
        {win.msgs.map((m) => <div key={m.id} data-seq={m.seq} />)}
      </div>
    </div>
  )
}

function mount(win: MessageWindow) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ManagersProvider, { managers: fakeManagers as never, children })
  const rendered = render(createElement(Harness, { win }), { wrapper })
  const scrollEl = rendered.container.querySelector('[data-scroll-container]') as HTMLDivElement
  return { ...rendered, scrollEl }
}

describe('useChatScroll ↔ ScrollSaver (подключение)', () => {
  it('скролл вверх запускает save() → loadOlder(), коммит нового окна запускает restore()', async () => {
    let loadOlderCalls = 0

    // «До»: 4 сообщения, seq2 торчит за верхний край контейнера — якорь
    // (reverse=true → elements[0], тот же сценарий, что в scrollSaver.test.ts).
    seqRects.set(1, { top: -300, bottom: -200 })
    seqRects.set(2, { top: -100, bottom: 100 })
    seqRects.set(3, { top: 100, bottom: 300 })
    seqRects.set(4, { top: 300, bottom: 600 })

    const win = makeWin([msg(1), msg(2), msg(3), msg(4)], {
      loadOlder: async () => { loadOlderCalls++ },
    })
    const { scrollEl, rerender } = mount(win)

    // Прогрев: на монтировании atBottomRef по умолчанию true → correctScroll() уже
    // пином к низу вызвал setScrollPositionSilently → ignoreNextScrollEvent() снял
    // реальный listener и повесил one-time, который проглотит САМОЕ БЛИЖАЙШЕЕ
    // scroll-событие. В настоящем браузере им стало бы нативное 'scroll' от того же
    // программного присваивания scrollTop; happy-dom его не эмулирует (программная
    // запись scrollTop не рождает событие) — слот остаётся висеть и без прогрева
    // проглотил бы шаг 1 теста. Один пустой dispatch here снимает его штатно, тем же
    // путём, каким это закрылось бы в реальном браузере.
    await act(async () => {
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })

    // Шаг 1 — просто зафиксировать lastScrollTopRef, вниз не триггерит save().
    await act(async () => {
      scrollEl.scrollTop = 800
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })
    expect(loadOlderCalls).toBe(0)

    // Шаг 2 — скролл вверх (800 → 200) в зоне подгрузки: save() + loadOlder().
    await act(async () => {
      scrollEl.scrollTop = 200
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })
    expect(loadOlderCalls).toBe(1)

    // «После»: прилетело новое сообщение (seq0, высота 100) ВЫШЕ старых —
    // якорь (seq2) сдвинулся на экране вниз на те же 100px, scrollTop
    // браузер сам не менял (200, как и был).
    seqRects.set(0, { top: -400, bottom: -300 })
    seqRects.set(2, { top: 0, bottom: 200 })
    containerScrollHeight = 1100

    const newWin = makeWin([msg(0), msg(1), msg(2), msg(3), msg(4)])
    await act(async () => { rerender(createElement(Harness, { win: newWin })) })

    // restore() должен был подвинуть scrollTop на +100 (200 → 300), чтобы
    // якорь остался в той же экранной позиции.
    expect(scrollEl.scrollTop).toBe(300)
  })

  // Ревью Задачи 4 (Б-1): предыдущая версия этого файла доказывала гейт
  // loadedAll.top ТОЛЬКО внутри scrollable.test.ts, колбэком, который
  // ПРОВЕРЯЛ САМ СЕБЯ (`onScrolledTop = () => { if (scrollable.loadedAll.top)
  // return; topCalls++ }`) — это тест собственного if теста, не подключения.
  // Реальный "укус" (Шаг 6 брифа) был показан временной мутацией и временным
  // тестом, оба откатывались — защиты в дереве не оставалось. Мутация
  // ревьюера подтвердила: без гейта в PRODUCTION-колбэке (`useChatScroll.ts`'s
  // onScrolledTop) весь набор тестов оставался зелёным. Этот тест бьёт по
  // РЕАЛЬНОМУ хуку через РЕАЛЬНЫЙ React-эффект-цикл, как и тест выше.
  it('win.reachedTop=true блокирует loadOlder() у верхнего края (loadedAll.top в РЕАЛЬНОМ хуке, не в тестовом колбэке)', async () => {
    let loadOlderCalls = 0
    seqRects.set(1, { top: -100, bottom: 100 })
    seqRects.set(2, { top: 100, bottom: 300 })
    const win = makeWin([msg(1), msg(2)], {
      reachedTop: true, // верх истории УЖЕ загружен целиком — loadedAll.top должно стать true
      loadOlder: async () => { loadOlderCalls++ },
    })
    const { scrollEl } = mount(win)

    // Прогрев (см. коммент у первого теста) + спуск подальше от края, чтобы
    // lastScrollDirection посчитался штатно от реального прошлого значения,
    // а не от default 0.
    await act(async () => {
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })
    await act(async () => {
      scrollEl.scrollTop = 800
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })

    // Подъём в зону триггера верха (<=onScrollOffset=300) — без гейта loadedAll.top
    // это вызвало бы save()+loadOlder() ровно как в сценарии первого теста.
    await act(async () => {
      scrollEl.scrollTop = 200
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })
    expect(loadOlderCalls).toBe(0)
  })

  // Ревью Задачи 4 (Б-1, вторая часть): мутация «убрать делегирование в
  // s.setScrollPositionSilently(), оставить голое el.scrollTop = value»
  // тоже оставляла все тесты зелёными — ни один не проверял, ЧЕРЕЗ ЧТО
  // именно идёт корректирующая запись, только куда она в итоге приводит
  // scrollTop (а голая запись даёт то же самое числовое значение). Спай на
  // Scrollable.prototype ловит именно способ записи, независимо от того,
  // какой из пяти вызывающих site'ов (пин к низу, restore(), компенсация
  // paddingTop, позиционирование непрочитанных, pinBottomNext) сработал
  // первым — здесь это пин к низу при монтировании (atBottomRef=true по
  // умолчанию → ResizeObserver-эффект зовёт correctScroll() синхронно).
  it('корректирующая запись при монтировании идёт через Scrollable.setScrollPositionSilently, не голым el.scrollTop', () => {
    const spy = vi.spyOn(Scrollable.prototype, 'setScrollPositionSilently')
    try {
      const win = makeWin([msg(1)])
      mount(win)
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

// Долг Задачи 4: починка залипшей стрелки «вниз» (пин к низу стал молчаливым —
// setScrollPositionSilently не рождает 'scroll', а showScrollDown раньше пересчитывался
// ТОЛЬКО из обработчика скролла) была сделана без теста. Этот тест ловит именно её:
// пин уходит из React-эффекта на изменение win (строка `useEffect(() => onAdditionalScroll(),
// [win.msgs, win.reachedBottom, onAdditionalScroll])` в useChatScroll.ts), а не из
// какого-либо scroll-события — убери этот эффект, и тест ниже покраснеет, потому что
// НИКАКОГО дальнейшего вызова onAdditionalScroll не будет.
describe('useChatScroll: стрелка «вниз» гаснет сама', () => {
  it('win.reachedBottom: false → true БЕЗ scroll-события гасит showScrollDown', async () => {
    // Окно уже во весь загруженный низ (dist=0), но реальный низ чата ещё не
    // подтверждён — ровно сценарий tweb «прыгнули в середину истории»: стрелка
    // видна, хотя scrollTop уже у низа ЗАГРУЖЕННОГО окна.
    containerScrollHeight = 500
    containerClientHeight = 500
    const win = makeWin([msg(1), msg(2)], { reachedBottom: false })
    const { scrollEl, rerender } = mount(win)

    await act(async () => {
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })
    expect(scrollEl.dataset.showScrollDown).toBe('1')

    // Пришла страница, подтвердившая реальный низ чата — БЕЗ единого scroll-события
    // (ни пользователь не скроллил, ни setScrollPositionSilently его не родил).
    const newWin = makeWin([msg(1), msg(2)], { reachedBottom: true })
    await act(async () => { rerender(createElement(Harness, { win: newWin })) })

    expect(scrollEl.dataset.showScrollDown).toBe('0')
  })
})
