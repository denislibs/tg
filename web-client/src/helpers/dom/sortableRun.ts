/**
 * Порт tweb `src/helpers/dom/sortableRun.ts` (812502980) — дословно: какие
 * соседи участвуют в перестановке (`cant-sort` — «не этот», `sortableClassName`
 * — «только эти») и сплошной прогон таких соседей вокруг элемента.
 */

/** Worn by a child that is not to be dragged, in a list that is sortable throughout */
const CANT_SORT_CLASS_NAME = 'cant-sort'

/**
 * Whether an element can take part in a reorder. `cant-sort` says "not this one"; a
 * `sortableClassName` is the other way round - only the children carrying it take part, which is
 * how a list where just a part of the rows is sortable (a chat list's pinned block) says so.
 */
export function isSortableElement(element: HTMLElement | null | undefined, sortableClassName?: string): element is HTMLElement {
  return !!element &&
    !element.classList.contains(CANT_SORT_CLASS_NAME) &&
    (!sortableClassName || element.classList.contains(sortableClassName))
}

/**
 * The maximal run of adjacent sortable siblings around `element`, in visual order, `element`
 * included. A sibling that cannot be sorted ends the run, which is what keeps a chat list's pinned
 * block - or a section of rows of any other kind - apart from everything else in the same list.
 */
export default function getSortableRun(element: HTMLElement, sortableClassName?: string) {
  const items: HTMLElement[] = [element]

  for(
    let sibling = element.previousElementSibling as HTMLElement | null;
    isSortableElement(sibling, sortableClassName);
    sibling = sibling.previousElementSibling as HTMLElement | null
  ) {
    items.unshift(sibling)
  }

  for(
    let sibling = element.nextElementSibling as HTMLElement | null;
    isSortableElement(sibling, sortableClassName);
    sibling = sibling.nextElementSibling as HTMLElement | null
  ) {
    items.push(sibling)
  }

  return items
}
