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
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useChatScroll } from './useChatScroll'
import { ManagersProvider } from './useManagers'
import type { MessageWindow } from './useMessageWindow'
import type { Message } from '../models'

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
  const { scrollRef, contentRef } = useChatScroll({
    numericChatId: 1, isRealChat: true, win, paddingTop: 0, unreadDividerSeq: null, unreadStickyTop: 0,
  })
  return (
    <div ref={scrollRef} data-scroll-container="1">
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
})
