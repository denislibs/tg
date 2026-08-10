// Scrollable (порт tweb components/scrollable.ts) — тесты на голом классе, без
// useChatScroll/React: happy-dom не считает layout (getBoundingClientRect,
// scrollHeight, clientHeight всегда 0), поэтому scrollHeight/clientHeight здесь —
// стабы через Object.defineProperty, тот же приём, что в scrollSaver.test.ts.
// scrollTop — настоящее DOM-свойство (happy-dom его честно хранит и отдаёт),
// его можно писать напрямую.
//
// throttleMeasurement (SCROLL_THROTTLE) откладывает измерение на 24мс setTimeout
// (при поддержке overlay-скролла) либо на requestAnimationFrame — какой ветке
// быть, решает IS_OVERLAY_SCROLL_SUPPORTED() в РЕАЛЬНОМ окружении теста, поэтому
// здесь не мокаются таймеры, а просто ждётся реальным таймером с запасом
// (`flushThrottle`), с тем же обоснованием, что в useChatScroll.test.tsx.
//
// Эти тесты доказывают арифметику/событийную механику Scrollable САМОГО ПО СЕБЕ
// (throttle, глушение, checkForTriggers) — они НЕ доказывают геометрию в
// реальном браузере (updateThumb/onMouseMove не покрыты — там нужен настоящий
// layout) и НЕ доказывают, что useChatScroll.ts подключает его правильно (это
// покрывает useChatScroll.test.tsx).
import { describe, it, expect, afterEach } from 'vitest'
import Scrollable from './scrollable'

async function flushThrottle() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

function makeContainer(scrollHeight: number, clientHeight: number, scrollTop = 0) {
  const container = document.createElement('div')
  document.body.append(container)
  Object.defineProperty(container, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: clientHeight, configurable: true })
  container.scrollTop = scrollTop
  return container
}

let scrollables: Scrollable[] = []
// container: undefined → Scrollable сам создаёт document.createElement('div') внутри —
// нам не нужен готовый узел заранее, передаём его явно во всех тестах ниже, поэтому
// эта фабрика существует только для симметрии с destroy()-очисткой.
function makeScrollable(container: HTMLElement) {
  const s = new Scrollable(undefined, 'test', 300, undefined, container)
  scrollables.push(s)
  return s
}

afterEach(() => {
  for (const s of scrollables) s.destroy()
  scrollables = []
  document.body.innerHTML = ''
})

describe('Scrollable — onScrolledTop/onScrolledBottom + loadedAll', () => {
  it('триггер верха срабатывает при подходе к краю', async () => {
    // scrollHeight 1000, clientHeight 500 → maxScrollPosition 500. onScrollOffset
    // по умолчанию 300 (как реальный tweb bubbles.ts: new Scrollable(null,'IM',300)).
    // Стартуем с scrollTop=0, СИММЕТРИЧНО lastScrollPosition-у Scrollable (тоже 0
    // по умолчанию — scrollable.ts's `this.onScroll()` в конструкторе ЗАКОММЕНТИРОВАН,
    // 1:1 как в tweb): если задать контейнеру scrollTop сразу при создании в обход
    // Scrollable, его lastScrollPosition не узнает об этом до первого реального
    // scroll-события — тогда ПЕРВОЕ измерение сравнит новое значение со СТАРЫМ
    // default 0, а не с фактическим прошлым scrollTop, и посчитает направление
    // неверно. Поэтому спускаемся вниз, а затем поднимаемся — обоими реальными
    // событиями, как в жизни.
    const container = makeContainer(1000, 500, 0)
    const scrollable = makeScrollable(container)

    // Проверяем ТОЛЬКО собственную триггер-арифметику Scrollable — direction/
    // threshold в checkForTriggers (scrollable.ts:433-457). loadedAll здесь
    // намеренно не участвует: он не читается внутри Scrollable (scrollable.ts:374 —
    // только поле, гейт — забота ВЫЗЫВАЮЩЕГО кода, tweb bubbles.ts's
    // loadMoreHistory), и колбэк-с-собственным-if внутри ЭТОГО файла проверял бы
    // только сам себя, а не Scrollable — такой тест раньше стоял здесь и был
    // убран по ревью (Задача 4, блокер Б-1): настоящую проверку гейта см. в
    // useChatScroll.test.tsx ('win.reachedTop=true блокирует loadOlder() у
    // верхнего края') — она бьёт по РЕАЛЬНОМУ производственному колбэку через
    // реальный React-эффект-цикл, дублировать эту проверку здесь нечего.
    let topCalls = 0
    scrollable.onScrolledTop = () => { topCalls++ }

    // Сначала вниз, подальше от обоих краёв — устанавливает lastScrollPosition=800
    // штатно, через реальное измерение (не триггерит ни один из краёв).
    container.scrollTop = 800
    container.dispatchEvent(new Event('scroll'))
    await flushThrottle()
    expect(topCalls).toBe(0)

    // Скролл вверх в зону триггера (800 → 200, <= onScrollOffset).
    container.scrollTop = 200
    container.dispatchEvent(new Event('scroll'))
    await flushThrottle()
    expect(topCalls).toBe(1)
  })

  it('триггер низа симметричен: срабатывает у края, гасится loadedAll.bottom', async () => {
    const container = makeContainer(1000, 500, 0)
    const scrollable = makeScrollable(container)
    // loadedAll.bottom уже false по умолчанию (scrollable.ts:374) — в отличие от
    // .top, явно выставлять не нужно.
    let bottomCalls = 0
    scrollable.onScrolledBottom = () => {
      if (scrollable.loadedAll.bottom) return
      bottomCalls++
    }

    // maxScrollPosition=500; в зоне триггера — scrollPosition >= 500-300=200.
    container.scrollTop = 250
    container.dispatchEvent(new Event('scroll'))
    await flushThrottle()
    expect(bottomCalls).toBe(1)

    scrollable.loadedAll.bottom = true
    container.scrollTop = 0
    container.dispatchEvent(new Event('scroll'))
    await flushThrottle()
    container.scrollTop = 250
    container.dispatchEvent(new Event('scroll'))
    await flushThrottle()
    expect(bottomCalls).toBe(1)
  })
})

describe('Scrollable — тихий скролл (setScrollPositionSilently/ignoreNextScrollEvent)', () => {
  it('тихая запись scrollTop не порождает вызов обработчика, следующее реальное событие — порождает', async () => {
    const container = makeContainer(1000, 500, 800)
    const scrollable = makeScrollable(container)
    let additionalCalls = 0
    scrollable.onAdditionalScroll = () => { additionalCalls++ }

    // Тихая запись, попадающая в зону триггера верха по значению — не должна
    // сама по себе родить измерение (нет 'scroll'-события — ничего не планируется).
    scrollable.setScrollPositionSilently(200)
    expect(container.scrollTop).toBe(200)
    await flushThrottle()
    expect(additionalCalls).toBe(0)

    // setScrollPositionSilently САМА снимает listener и вешает one-time (см.
    // scrollable.ts:354-362) — ближайшее 'scroll'-событие проглатывается им, а
    // не обработчиком (в браузере им стало бы нативное 'scroll' от той же
    // программной записи; happy-dom его не эмулирует — эмулируем вручную).
    container.dispatchEvent(new Event('scroll'))
    await flushThrottle()
    expect(additionalCalls).toBe(0)

    // Реальный listener восстановлен one-time обработчиком — следующее событие
    // обрабатывается штатно.
    container.scrollTop = 210
    container.dispatchEvent(new Event('scroll'))
    await flushThrottle()
    expect(additionalCalls).toBe(1)
  })
})

describe('Scrollable — throttle не теряет последнее событие', () => {
  it('несколько scroll-событий подряд внутри окна throttle схлопываются в одно измерение ПОСЛЕДНЕГО значения', async () => {
    const container = makeContainer(1000, 500, 0)
    const scrollable = makeScrollable(container)
    const measured: number[] = []
    scrollable.onAdditionalScroll = () => { measured.push(scrollable.lastScrollPosition) }

    // Три события подряд, синхронно (throttleMeasurement ещё не успел сработать
    // между ними — onScrollMeasure остаётся ненулевым, onScroll выходит рано на
    // втором и третьем, scrollable.ts:225).
    container.scrollTop = 50
    container.dispatchEvent(new Event('scroll'))
    container.scrollTop = 120
    container.dispatchEvent(new Event('scroll'))
    container.scrollTop = 260
    container.dispatchEvent(new Event('scroll'))

    await flushThrottle()

    // Одно измерение — и оно взяло АКТУАЛЬНОЕ (последнее) значение scrollTop на
    // момент срабатывания таймера/rAF, а не первое из трёх запланировавших его
    // событий: throttle читает container.scrollTop заново внутри callback'а
    // (scrollable.ts:229 — `const scrollPosition = this.scrollPosition`), не
    // кэширует его на момент dispatchEvent.
    expect(measured).toEqual([260])
  })
})
