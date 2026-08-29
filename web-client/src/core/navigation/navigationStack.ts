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
//
// СЕРИАЛИЗАЦИЯ history.pushState()/history.back() (баг-репорт solid-wave-1,
// задача 4). `history.back()` асинхронна: браузер фиксирует ЦЕЛЬ перехода
// (текущий индекс минус один) В МОМЕНТ ВЫЗОВА, а сам переход и `popstate`
// происходят позже, отдельной задачей. Если между вызовом `history.back()` и
// этим более поздним переходом успевает выполниться ЕЩЁ ОДИН `history.pushState()`
// (типичный сценарий — один оверлей программно закрывается и тут же открывается
// следующий, как меню сообщения → диалог подтверждения удаления), зафиксированная
// РАНЬШЕ цель back() всё равно применяется к уже сдвинувшейся текущей позиции —
// стек `layers` (наша модель) и реальная позиция браузера расходятся на один
// уровень. Следующее программное закрытие (например, popup.hide() по Esc)
// вызывает СВОЙ history.back() уже от этой съехавшей позиции и отматывает МИМО
// записи чата — к самой первой записи сессии (hash обнуляется), а любой
// pushState чата после этого может быть переписан ещё не сработавшим
// «отложенным» back() из более ранней такой пары push+back — до перезагрузки
// страницы, которая одна лишь сбрасывает эту память браузера.
//
// tweb знает про эту гонку буквально (appNavigationController.ts,
// modifyHistoryFromEvent: «have to have this timeout, otherwise browser will
// eat the event if you do push and back together») и лечит её ОЧЕРЕДЬЮ
// историй-мутаций с ожиданием подтверждения — но только для ветки Navigation
// API (`USE_NAVIGATION_API`); легаси-путь (`history.pushState`/`history.back`
// напрямую, наш единственный путь — Navigation API мы не портировали)
// сериализации в оригинале не получает вовсе. Поэтому здесь это не порт
// конкретных строк tweb, а адаптация ЕГО ЖЕ приёма (та же очередь с ожиданием
// подтверждения) на путь, который у tweb это ожидание не получает.
let historyBusy = false
const historyOpsQueue: Array<() => void> = []

function runHistoryOp(op: () => void): void {
  if (historyBusy) { historyOpsQueue.push(op); return }
  op()
}

/** Подтверждение эффекта текущей мутации — снимает "занято" и берёт следующую
 *  из очереди (если она тоже мутация push, settle придёт сама, синхронно). */
function historyOpSettled(): void {
  historyBusy = false
  const next = historyOpsQueue.shift()
  if (next) runHistoryOp(next)
}

/**
 * `onPop` возвращает `false` — ВЕТО: слой отказывается сниматься, и стек
 * возвращает его на место (порт tweb `appNavigationController.handleItem`,
 * :290-303: `if(good === false) spliceItems(min(len, wasIndex), 0, item)`).
 * Единственный живой потребитель — медиавьювер: пока летит мувер, снимать слой
 * нельзя, иначе Back в этот момент убивает его навсегда (вьювер при этом
 * остаётся открытым — его `close()` во время полёта отклоняется).
 */
export interface Layer { onPop: () => boolean | void }

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
  if (ignorePop) {
    // Это popstate, съеденный НАШИМ же history.back() (removeLayer ниже) —
    // подтверждение того, что мутация состоялась: снимаем "занято" и пускаем
    // следующую в очереди (см. докблок файла).
    ignorePop = false
    historyOpSettled()
    return
  }
  const wasIndex = layers.length - 1
  const top = layers.pop()
  if (top) {
    if (top.onPop() === false) {
      // Слой на место — и запись истории обратно: в нашей модели каждый слой
      // владеет ровно одной записью (см. pushLayer/removeLayer), а браузер свою
      // уже съел этим самым popstate. Без возврата записи следующий
      // `removeLayer` откусил бы чужую и выкинул пользователя со страницы.
      // Эта мутация — прямой синхронный ответ на УЖЕ случившийся реальный
      // popstate (не наша очередь: historyBusy тут всегда false, иначе мы бы
      // ушли в ветку ignorePop выше), гонка ей не грозит — через очередь не гоним.
      layers.splice(Math.min(layers.length, wasIndex), 0, top)
      history.pushState({ ...history.state, navDepth: layers.length }, '')
    }
    return
  }
  // Оверлеев нет — это навигация чата (хэш). Отдаём базовому слою.
  baseHandler?.()
}

/** Базовый слой (навигация чата по хэшу) — вызывается, когда стек оверлеев пуст. */
export function setBaseHandler(fn: () => void): void {
  baseHandler = fn
  ensureInstalled()
}

/**
 * Сериализованный `history.pushState` ВНЕ стека слоёв — единственный
 * потребитель: `useUrlSync` (push нового хэша чата при смене `selectedId`/
 * `openThread`). Это НЕ слой (Back по нему не снимает оверлей — это базовая
 * навигация), но реальный DOM-вызов истории всё равно обязан вставать в ту же
 * очередь, что `pushLayer`/`removeLayer` (см. докблок файла): иначе гонка
 * просто переезжает на один уровень выше — pushState чата, вызванный между
 * `removeLayer` оверлея и подтверждением его `history.back()`, либо обгонит
 * ещё не подтверждённый back (тот же класс дефекта A), либо будет РАЗ ВЕРНУТ,
 * когда более ранний отложенный back наконец сработает (дефект B: чат как
 * будто открылся и тут же беззвучно закрылся).
 */
export function pushHashState(url: string): void {
  ensureInstalled()
  runHistoryOp(() => {
    history.pushState(null, '', url)
    historyOpSettled()
  })
}

/** Открыть слой-оверлей: пушит запись истории, возвращает хэндл для снятия.
 *  `onPop` может вернуть `false` — см. вето в `Layer`. */
export function pushLayer(onPop: () => boolean | void): Layer {
  ensureInstalled()
  const layer: Layer = { onPop }
  layers.push(layer)
  // Реальный pushState — через очередь (см. докблок файла): если в этот момент
  // ещё не подтверждён предыдущий history.back() (слой закрывался прямо перед
  // этим), наш push ждёт своей очереди, а не обгоняет его.
  runHistoryOp(() => {
    history.pushState({ ...history.state, navDepth: layers.length }, '')
    historyOpSettled() // pushState синхронен — эффект подтверждён сразу же
  })
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
    runHistoryOp(() => {
      // history.back() асинхронна: "занято" до тех пор, пока не придёт её
      // popstate (ветка ignorePop в handlePop зовёт historyOpSettled()) —
      // это и есть сериализация, ради которой заведена очередь.
      historyBusy = true
      ignorePop = true
      history.back()
      // Предохранитель: если по какой-то причине popstate не пришёл вовсе
      // (например, back() уже упёрся в дно сессии) — не держать очередь
      // забитой навечно. handlePop гасит ignorePop первым, так что при
      // нормальном срабатывании это — no-op (idempotent на historyOpSettled).
      setTimeout(() => {
        if (!ignorePop) return
        ignorePop = false
        historyOpSettled()
      }, 500)
    })
  }
}
