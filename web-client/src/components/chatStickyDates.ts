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

type Unobserver = { unobserve(element: HTMLElement, headerSentinel?: HTMLElement): void }

/**
 * Секции, которых больше нет в DOM, — снять с обоих IntersectionObserver'ов
 * StickyIntersector'а (`unobserve`) и вычистить из внешних реестров (`observed`,
 * `stuck`). Без этого `observed`/`stuck` бессрочно удерживают отсоединённые
 * секции, а оба observer'а внутри StickyIntersector продолжают их наблюдать —
 * утечка памяти.
 *
 * Путь удаления секций есть уже сегодня, не только после виртуализации:
 * `useMessageWindow.jumpTo`/`reloadNewest` (useMessageWindow.ts:136-149) делают
 * ПОЛНУЮ подмену `win.msgs` (не merge), а `ChatFeed.tsx` рендерит секции по
 * `key={sec.key}` — день, которого нет в новом окне, размонтируется React'ом
 * тем же коммитом.
 *
 * Проверяем принадлежность именно `container` (тому же элементу, что и
 * `observeNewSections`), а не глобальному `document`, — секция может быть
 * отсоединена от контейнера и всё ещё технически валидным DOM-узлом; в тестах
 * (в отличие от прод-дерева) `container` к тому же не обязан быть примонтирован
 * к `document` вовсе.
 */
export function pruneEvictedSections(container: Element, intersector: Unobserver, observed: Set<HTMLElement>, stuck: Set<HTMLElement>): void {
  for (const el of observed) {
    if (container.contains(el)) continue
    intersector.unobserve(el)
    observed.delete(el)
    stuck.delete(el)
  }
}
