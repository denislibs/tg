// Чистая логика пейджера фото профиля (шапка панели профиля).
// Порт поведения из tweb `peerProfileAvatars.ts`: тап по краевым третям фото
// листает, центральная треть открывает просмотрщик; свайп листает с остановкой
// на краях. Вынесено из компонента, чтобы покрыть тестами без DOM/менеджеров.

/** Зона тапа по фото: листаем назад/вперёд либо открываем просмотрщик. */
export type PagerZone = 'prev' | 'next' | 'viewer'

/**
 * Клампит индекс фото в [0, count-1] (стоп на краях — как свайп в tweb, где
 * translate ограничен minX). Пустой список → 0.
 */
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0
  if (index < 0) return 0
  if (index > count - 1) return count - 1
  return index
}

/**
 * Определяет зону тапа по горизонтали (tweb SWITCH_ZONE = 1/3): центральная
 * треть — просмотрщик, левая/правая треть — листание. Если листать некуда
 * (одно фото / `canPage`=false) — всегда просмотрщик.
 */
export function pickZone(clickX: number, width: number, canPage: boolean): PagerZone {
  if (!canPage || width <= 0) return 'viewer'
  const third = width / 3
  if (clickX >= third && clickX <= width - third) return 'viewer'
  return clickX < width / 2 ? 'prev' : 'next'
}

/**
 * Следующий индекс при тапе по краевой зоне. Как в tweb: тап зациклен по кругу
 * (с первого влево → на последний, с последнего вправо → на первый).
 */
export function stepIndex(index: number, count: number, dir: 'prev' | 'next'): number {
  if (count <= 1) return 0
  if (dir === 'next') return index === count - 1 ? 0 : index + 1
  return index === 0 ? count - 1 : index - 1
}

/**
 * Итоговый индекс после свайпа: сдвиг на ±1 при превышении порога, со стопом на
 * краях (tweb clamps swipe translate, не зацикливая). Порог — доля ширины фото.
 * `dx` — смещение указателя (px, влево отрицательное), `width` — ширина фото.
 */
export function indexAfterSwipe(index: number, count: number, dx: number, width: number, ratio = 0.2): number {
  if (count <= 1 || width <= 0) return clampIndex(index, count)
  const threshold = width * ratio
  if (dx <= -threshold) return clampIndex(index + 1, count)
  if (dx >= threshold) return clampIndex(index - 1, count)
  return clampIndex(index, count)
}
