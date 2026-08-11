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

function Harness({ win, paddingTop = 0, unreadDividerSeq = null }: {
  win: MessageWindow, paddingTop?: number, unreadDividerSeq?: number | null,
}) {
  const { scrollRef, contentRef, showScrollDown, userScrolledUpRef } = useChatScroll({
    numericChatId: 1, isRealChat: true, win, paddingTop, unreadDividerSeq, unreadStickyTop: 0,
  })
  return (
    // data-show-scroll-down/data-user-scrolled-up зеркалят состояние хука наружу —
    // снаружи React-состояние (и рефы) не пощупать иначе; читаются на каждом
    // рендере, так что отражают САМОЕ СВЕЖЕЕ значение ref на момент рендера.
    <div
      ref={scrollRef}
      data-scroll-container="1"
      data-show-scroll-down={showScrollDown ? '1' : '0'}
      data-user-scrolled-up={userScrolledUpRef.current ? '1' : '0'}
    >
      <div ref={contentRef}>
        {win.msgs.map((m) => (
          // data-unread-divider — маркер плашки «Непрочитанные сообщения»
          // (реальный ряд её несёт в UnreadDivider.tsx); хук ищет её через
          // `sc?.querySelector('[data-unread-divider]')`.
          <div key={m.id} data-seq={m.seq} {...(m.seq === unreadDividerSeq ? { 'data-unread-divider': '' } : {})} />
        ))}
      </div>
    </div>
  )
}

// Общий wrapper для render(..., { wrapper }) — вынесен один раз, чтобы новый
// харнес (HarnessRealMarkup ниже) не плодил второй такой же inline-литерал.
function managersWrapper({ children }: { children: ReactNode }) {
  return createElement(ManagersProvider, { managers: fakeManagers as never, children })
}

function mount(win: MessageWindow, extra: { paddingTop?: number, unreadDividerSeq?: number | null } = {}) {
  const rendered = render(createElement(Harness, { win, ...extra }), { wrapper: managersWrapper })
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

  // Финальное ревью ветки (I-5, симметрия): тест выше держит loadedAll.top, но
  // его близнец — useChatScroll.ts's `s.loadedAll.bottom = win.reachedBottom`
  // (та же строка сихронизации, соседняя половина) — тестом не был покрыт
  // вообще: снятие ЭТОЙ строки оставляло весь набор зелёным, потому что
  // Scrollable's дефолт (`loadedAll: {top:true, bottom:false}`) без синхронизации
  // так и остаётся `false` — само по себе НЕ блокирует триггер низа (гейт
  // читает `s.loadedAll.bottom` — не заблокировано, а не «заблокировано
  // неверно»), поэтому баг был бы виден только в реальном браузере на
  // кэш-открытии с уже загруженным низом (лишний loadNewer при каждом подходе
  // к нижнему краю). Тот же приём: реальный хук, реальный React-эффект-цикл.
  it('win.reachedBottom=true блокирует loadNewer() у нижнего края (loadedAll.bottom в РЕАЛЬНОМ хуке, не в тестовом колбэке)', async () => {
    let loadNewerCalls = 0
    const win = makeWin([msg(1), msg(2)], {
      reachedBottom: true, // низ УЖЕ загружен целиком — loadedAll.bottom должно стать true
      loadNewer: async () => { loadNewerCalls++ },
    })
    const { scrollEl } = mount(win)

    // Прогрев + подъём в зону триггера низа (containerScrollHeight=1000 по
    // умолчанию, clientHeight=500 → maxScrollPosition=500; порог 300 →
    // scrollTop>=200 уже в зоне «близко к низу»).
    await act(async () => {
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })
    await act(async () => {
      scrollEl.scrollTop = 250
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })

    // Без гейта loadedAll.bottom это вызвало бы loadNewer() — окно уже в
    // пределах порога 300px от низа контейнера.
    expect(loadNewerCalls).toBe(0)
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

// Финальное ревью ветки (раунд после Задачи 5): C-1/C-2. Задача 4 заглушила
// setScrollPositionSilently (правильно), раунд 3 сузил deps эффекта выше до
// [win.msgs, win.reachedBottom] (тоже правильно) — вместе они сняли ОБА пути,
// которыми база пересчитывала состояние после программного пина: реальное
// scroll-событие (глушится тихой записью by design) и eager-эффект на КАЖДЫЙ
// ререндер (сужен намеренно). На кэш-открытии (окно уже в сторе ПЕРВЫМ
// коммитом, win.msgs/win.reachedBottom не МЕНЯЮТСЯ между рендерами — эффект
// молчит) не остаётся ни одного пути пересчёта. Фикс — correctScroll() зовёт
// onAdditionalScroll()/checkForTriggers() сама, после своей же тихой записи.
describe('useChatScroll: тихий пин корректно пересчитывает состояние (C-1/C-2)', () => {
  it('C-1: кэш-открытие первым коммитом — стрелка «вниз» не залипает после тихого пина', () => {
    // Окно уже в сторе ДО первого рендера (кэш-открытие/возврат в чат) — Harness
    // монтируется сразу с msgs, а не догоняет их отдельным rerender. scrollTop
    // стартует 0 (React ещё не успел ничего написать), scrollHeight/clientHeight
    // задают большой dist — ровно сценарий ревью, воспроизведённый численно:
    // "scrollTop = 5000, при этом data-show-scroll-down = '1'".
    containerScrollHeight = 5000
    containerClientHeight = 500
    const win = makeWin([msg(1), msg(2)], { reachedBottom: true }) // реальный низ уже загружен
    const { scrollEl } = mount(win)

    // Тихий пин из correctScroll() (ResizeObserver-эффект монтирования) должен
    // был случиться...
    expect(scrollEl.scrollTop).toBe(5000)
    // ...и то же correctScroll() обязано было пересчитать showScrollDown ПОСЛЕ
    // записи — иначе тут осталось бы стухшее значение с первого прохода
    // onAdditionalScroll(), снятое при scrollTop=0.
    expect(scrollEl.dataset.showScrollDown).toBe('0')
  })

  it('C-2: кэш-открытие мид-history — тихий пин запускает checkForTriggers → loadNewer', () => {
    // win.reachedBottom=false — мы прыгнули в середину истории, реальный низ
    // чата ещё не загружен. Тихий пин ставит scrollTop на границу загруженного
    // окна (dist=0 от НЕГО) — ровно порог onScrolledBottom. Без вызова
    // checkForTriggers() из correctScroll() это никогда бы не всплыло: триггер
    // живёт только внутри checkForTriggers, а её зовёт исключительно throttled
    // onScroll, которого тихая запись не рождает.
    let loadNewerCalls = 0
    containerScrollHeight = 5000
    containerClientHeight = 500
    const win = makeWin([msg(1), msg(2)], {
      reachedBottom: false,
      loadNewer: async () => { loadNewerCalls++ },
    })
    mount(win)

    expect(loadNewerCalls).toBe(1)
  })

  // Ре-ревью после I-4/I-5 (перенос choke point'а с correctScroll на
  // setScrollTopSilently): координатор нашёл ЗЕРКАЛЬНУЮ дыру C-1 на ДРУГОМ
  // тихом писателе — начальном позиционировании плашки «Непрочитанные
  // сообщения» (открытие чата с unreadDividerSeq). Запись двигает вьюпорт с
  // низа (открытие чата пином к низу) на плашку где-то в середине истории —
  // тысячи пикселей — и раньше НИКТО не пересчитывал состояние после нёе:
  // событие заглушено (setScrollPositionSilently), win.msgs/reachedBottom не
  // менялись (эффект висит на unreadDividerSeq, не на них), correctScroll не
  // звался (это отдельный эффект). Стрелка «вниз» оставалась ПОГАШЕННОЙ, пока
  // пользователь стоял в середине истории.
  it('C-1 (зеркало): начальное позиционирование плашки непрочитанных зажигает стрелку «вниз»', async () => {
    containerScrollHeight = 5000
    containerClientHeight = 500
    const win = makeWin([msg(1), msg(2), msg(3)], { reachedBottom: true })

    // Шаг 1 — монтируем БЕЗ плашки (unreadDividerSeq: null, дефолт Harness):
    // эффект плашки — no-op (гейт `unreadDividerSeq == null`), единственный
    // писатель — тихий пин к низу из correctScroll. Проверяем, что ОН сам по
    // себе уже корректно гасит стрелку (тот же факт, что доказывает тест C-1
    // выше) — так шаг 2 ниже проверяет ИЗОЛИРОВАННО эффект плашки, а не
    // случайно унаследованное «застряло true» с самого начала монтирования.
    const { scrollEl, rerender } = mount(win)
    expect(scrollEl.scrollTop).toBe(5000)
    expect(scrollEl.dataset.showScrollDown).toBe('0')

    // Шаг 2 — плашка (seq=2) СЕЙЧАС (при scrollTop у низа) лежит далеко ВЫШЕ
    // вьюпорта — как и было бы у сообщения из начала истории при открытии
    // чата пином к низу. Дописываем unreadDividerSeq РЕРЕНДЕРОМ (не в
    // изначальном mount) — ровно чтобы шаг 1 успел зафиксировать «было
    // корректно 0» ДО того, как плашка что-то сдвинула.
    seqRects.set(2, { top: -4000, bottom: -3980 })
    await act(async () => { rerender(createElement(Harness, { win, unreadDividerSeq: 2 })) })

    // scrollTop должен был уйти с низа (5000) далеко в середину истории...
    expect(scrollEl.scrollTop).toBeLessThan(2000)
    // ...и стрелка «вниз» обязана загореться — БЕЗ единого scroll-события
    // (запись тихая) и без изменения win.msgs/win.reachedBottom (которые эту
    // стрелку тоже умеют пересчитать, но здесь не менялись).
    expect(scrollEl.dataset.showScrollDown).toBe('1')
  })
})

// Финальное ревью ветки (I-5): `setScrollTopSilently`'s `lastScrollTopRef.current
// = value` (useChatScroll.ts:91, фикс Б-6 из task-4-report.md) не был покрыт
// тестом — снятие этой строки оставляло весь набор зелёным. Смысл строки: КАЖДАЯ
// тихая корректирующая запись обязана двигать вперёд базу, от которой
// onAdditionalScroll считает "пользователь ушёл вверх" (`st < lastScrollTopRef.current
// - 1`), иначе следующий РЕАЛЬНЫЙ маленький скролл пользователя сверяется с
// устаревшей ДОкоррекционной точкой отсчёта и детекция молча пропадает. Пин к
// низу/restore() (через correctScroll) не годятся для теста — C-1/C-2 выше
// научили correctScroll звать onAdditionalScroll() сразу следом, а он САМ
// безусловно переписывает lastScrollTopRef в конце (`lastScrollTopRef.current =
// st`) — маскирует баг этой строки. Компенсация paddingTop — единственный
// вызывающий site, который НЕ сопровождается таким пересчётом, поэтому он и
// показывает строку 91 в чистом виде.
describe('useChatScroll: тихая запись двигает базу для детекции "ушёл вверх" (lastScrollTopRef)', () => {
  it('компенсация paddingTop обновляет базу — следующий маленький реальный скролл вверх засчитывается', async () => {
    containerScrollHeight = 500
    containerClientHeight = 500
    const win = makeWin([msg(1), msg(2)], { reachedBottom: true })
    const { scrollEl, rerender } = mount(win)

    // Прогрев: гасит swallow-listener от тихого пина при монтировании (см.
    // комментарий у первого теста файла).
    await act(async () => {
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })
    expect(scrollEl.scrollTop).toBe(500) // тихий пин при монтировании случился

    // "Пришли новые сообщения" — увеличиваем доступный overflow, не трогая
    // сам scrollTop; нужно только для dist>240 у финальной проверки ниже.
    containerScrollHeight = 5000

    // Компенсация paddingTop (useChatScroll.ts, `setScrollTopSilently(el.scrollTop
    // + delta)`) — тихая запись БЕЗ сопровождающего onAdditionalScroll (в отличие
    // от correctScroll после фикса C-1/C-2) — чистый сценарий для строки 91.
    await act(async () => { rerender(createElement(Harness, { win, paddingTop: 1000 })) })
    expect(scrollEl.scrollTop).toBe(1500) // 500 (было) + 1000 (delta paddingTop)

    // Прогрев swallow-listener'а ОТ ЭТОЙ силентной записи — иначе следующий
    // dispatch проглотится вхолостую, как и после мутационного пина.
    await act(async () => {
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })

    // РЕАЛЬНОЕ движение пользователя вверх на 20px от скорректированной позиции
    // (1500 → 1480) — маленький, но настоящий скролл, обязанный засчитаться как
    // "пользователь ушёл от низа". Без строки 91 lastScrollTopRef остался бы на
    // устаревшей ДОкоррекционной базе (500) — 1480 < 500-1 ложно, детекция
    // пропала бы молча.
    await act(async () => {
      scrollEl.scrollTop = 1480
      scrollEl.dispatchEvent(new Event('scroll'))
      await flushScrollThrottle()
    })

    expect(scrollEl.dataset.userScrolledUp).toBe('1')
  })
})

// Регрессия (бэклог этапа 2.1, п.1): реальная разметка бабла (ChatFeed.tsx +
// MessageRow.tsx) несёт ТОЛЬКО data-seq — граница «непрочитанные» это модификатор
// is-first-unread на самом бабле, а не отдельный узел с data-unread-divider.
// Атрибута data-unread-divider в продовом коде нет нигде — коммит 448ff52 убрал
// отдельную плашку-<div>, а хук продолжал искать её по старому селектору. Harness
// выше подмешивает фиктивный data-unread-divider РЯДОМ с data-seq у того же узла,
// поэтому не мог поймать регрессию: до фикса хук искал бы селектор, которого в
// проде не существует, тратя весь 3с rAF-таймаут вхолостую. Этот харнес — точный
// слепок продовой разметки (только data-seq) — доказывает, что якорь держится
// именно на нём.
function HarnessRealMarkup({ win, unreadDividerSeq }: { win: MessageWindow, unreadDividerSeq: number | null }) {
  const { scrollRef, contentRef, showScrollDown } = useChatScroll({
    numericChatId: 1, isRealChat: true, win, paddingTop: 0, unreadDividerSeq, unreadStickyTop: 0,
  })
  return (
    <div ref={scrollRef} data-scroll-container="1" data-show-scroll-down={showScrollDown ? '1' : '0'}>
      <div ref={contentRef}>
        {win.msgs.map((m) => <div key={m.id} data-seq={m.seq} />)}
      </div>
    </div>
  )
}

describe('useChatScroll: якорь плашки непрочитанных — по data-seq, разметка без фиктивного маркера', () => {
  it('позиционирует вьюпорт на бабле с data-seq===unreadDividerSeq (продовая разметка, без data-unread-divider)', () => {
    containerScrollHeight = 5000
    containerClientHeight = 500
    const win = makeWin([msg(1), msg(2), msg(3)], { reachedBottom: true })
    // Плашка (seq=2) лежит далеко ВЫШЕ вьюпорта, как у сообщения из начала
    // истории при открытии чата, который пином к низу отвёл бы viewport на 5000.
    seqRects.set(2, { top: -4000, bottom: -3980 })

    const rendered = render(createElement(HarnessRealMarkup, { win, unreadDividerSeq: 2 }), { wrapper: managersWrapper })
    const scrollEl = rendered.container.querySelector('[data-scroll-container]') as HTMLDivElement

    // Без селектора по data-seq хук не нашёл бы цель вовсе — scrollTop остался
    // бы на пине к низу (5000, см. correctScroll). С фиксом якорь уводит
    // viewport в середину истории, к бабблу-плашке.
    expect(scrollEl.scrollTop).toBeLessThan(2000)
  })
})
