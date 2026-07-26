// Чистая логика перелистывания пин-бара (tweb pinnedMessage): список пинов
// приходит новейшим первым (index 0 = новейший). Клик по плашке прыгает к
// показанному пину и переводит бар на следующий (более старый, циклически) —
// tweb followPinnedMessage: testMid(pinnedIndex >= count-1 ? pinnedMaxMid : mid-1).

/** Следующий индекс после клика: вниз по списку (к более старым), циклически. */
export function nextPinIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return (index + 1) % count
}

/** Индекс после смены списка пинов: вне диапазона — сброс на новейший. */
export function clampPinIndex(index: number, count: number): number {
  return index < 0 || index >= count ? 0 : index
}

/**
 * Номер «#N» в подписи плашки (tweb AnimatedCounter: count - pinnedIndex,
 * скрыт на новейшем пине — класс is-last при index 0). null — без номера.
 */
export function pinBadgeNumber(index: number, count: number): number | null {
  if (count <= 1 || index <= 0 || index >= count) return null
  return count - index
}
