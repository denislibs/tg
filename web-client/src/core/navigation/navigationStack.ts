// Стек навигации под кнопку «Назад» (Phase B роутинга, порт идеи tweb
// appNavigationController). Единственный владелец popstate в приложении.
//
// Слои-оверлеи (попапы, инфо-панель, лайтбокс, полноэкранные экраны сайдбара)
// при открытии кладут слой и пушат запись истории; браузерный/аппаратный Back
// снимает ВЕРХНИЙ слой (onPop → закрыть именно его). Когда оверлеев нет, Back
// уходит в базовый слой — навигацию чата по хэшу (useUrlSync регистрирует его
// через setBaseHandler). Так один Back выходит из слоёв по одному, как в Telegram.
//
// Допущение LIFO: оверлеи закрываются в обратном порядке (как модалки почти
// всегда и делают). Программное закрытие верхнего слоя «съедает» свою запись
// истории через history.back() под флагом ignorePop, чтобы не сработал onPop.

interface Layer { onPop: () => void }

const layers: Layer[] = []
let baseHandler: (() => void) | null = null
let ignorePop = false
let installed = false

function ensureInstalled(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('popstate', handlePop)
}

function handlePop(): void {
  if (ignorePop) { ignorePop = false; return }
  const top = layers.pop()
  if (top) { top.onPop(); return }
  // Оверлеев нет — это навигация чата (хэш). Отдаём базовому слою.
  baseHandler?.()
}

/** Базовый слой (навигация чата по хэшу) — вызывается, когда стек оверлеев пуст. */
export function setBaseHandler(fn: () => void): void {
  baseHandler = fn
  ensureInstalled()
}

/** Открыть слой-оверлей: пушит запись истории, возвращает хэндл для снятия. */
export function pushLayer(onPop: () => void): Layer {
  ensureInstalled()
  const layer: Layer = { onPop }
  layers.push(layer)
  history.pushState({ ...history.state, navDepth: layers.length }, '')
  return layer
}

/** Снять слой (программное закрытие: × / onClose). Если Back его уже снял —
 *  no-op. Иначе «съедаем» свою запись истории без повторного onPop. */
export function removeLayer(layer: Layer): void {
  const idx = layers.lastIndexOf(layer)
  if (idx === -1) return // уже снят кнопкой Back
  const wasTop = idx === layers.length - 1
  layers.splice(idx, 1)
  if (wasTop) {
    ignorePop = true
    history.back()
  }
}
