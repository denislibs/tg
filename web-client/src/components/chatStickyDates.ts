// Проводка Chat.tsx поверх StickyIntersector (components/stickyIntersector.ts):
// следит за секциями `.bubbles-date-group` внутри ленты чата и решает, какая
// дата сейчас прилипшая (is-sticky). Вынесено из useEffect в отдельный модуль,
// чтобы это можно было покрыть юнит-тестами — Chat.tsx нигде не рендерится в
// vitest (слишком тяжёлое дерево зависимостей), так что логика внутри самого
// эффекта тестами не ловится.

/** tweb bubbles.ts: секция дня — контейнер `.bubbles-date-group`, куда
 * `getDateContainerByTimestamp` кладёт дата-пилюлю и все сообщения дня. */
export function isDateGroupSection(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.classList.contains('bubbles-date-group')
}

/**
 * tweb bubbles.ts:1382-1408 (колбэк StickyIntersector) — среди застрявших
 * секций is-sticky получает только «нижняя» (последняя по дню): там это
 * обход `this.dateMessages` (реестр секций по timestamp) в поисках
 * максимального. У нас такого реестра нет — секции и так лежат в DOM по
 * возрастанию дня (`ChatFeed.tsx` строит их последовательным проходом уже
 * отсортированного окна сообщений), поэтому эквивалент — последняя
 * застрявшая секция в document order.
 */
export function pickStickyDateKey(sections: Iterable<Element>, stuck: ReadonlySet<HTMLElement>): string | null {
  let key: string | null = null
  for (const section of sections) {
    if (isDateGroupSection(section) && stuck.has(section)) {
      key = section.querySelector<HTMLElement>('.bubble.is-date')?.dataset.date ?? key
    }
  }
  return key
}

type Observer = { observeStickyHeaderChanges(element: HTMLElement): void }

/**
 * Наблюдает НЕ увиденные ранее секции ровно один раз (список уже
 * пронаблюдённых секций передаётся снаружи и переживает повторные вызовы).
 *
 * `StickyIntersector.observeStickyHeaderChanges` не идемпотентна — как и в
 * tweb, каждый вызов добавляет НОВЫЙ sentinel-узел в контейнер
 * (`addSentinel` → `appendChild`), а `disconnect()`/повторный `observe()`
 * старые узлы не убирают. В tweb это безопасно: `observeStickyHeaderChanges`
 * зовётся ровно один раз за жизнь секции (`bubbles.ts:4867`, секция создаётся
 * и наблюдается в одном месте). У нас `.bubbles-date-group` — React-узел со
 * стабильным ключом, переживающий ререндеры; без этой обвязки повторный
 * вызов из useEffect на каждое изменение ленты плодил бы новый
 * `.sticky_sentinel` в каждой дата-секции при каждом входящем сообщении.
 */
export function observeNewSections(container: Element, intersector: Observer, observed: Set<HTMLElement>): void {
  for (const child of container.children) {
    if (isDateGroupSection(child) && !observed.has(child)) {
      observed.add(child)
      intersector.observeStickyHeaderChanges(child)
    }
  }
}
