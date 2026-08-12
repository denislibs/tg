// Ядро реконсайла — порт намерения tweb `saveDialogFilter` (lib/storages/filters.ts:513-518):
//
//   const oldFilter = this.filters[filter.id];
//   if(oldFilter) filter = Object.assign(oldFilter, filter);
//   else          this.filters[filter.id] = filter;
//
// В tweb UI на Solid, поэтому там сливают ПОЛЯ В существующий объект: идентичность
// сохраняется, а реактивность ловит изменения полей. React так не умеет — он
// сравнивает ссылки, и мутация прошла бы мимо мемоизированных компонентов.
// Поэтому у нас то же намерение выражено иначе: вернуть СТАРЫЙ объект, если после
// слияния он структурно не изменился, и НОВЫЙ, если изменился. Итог тот же:
//   • не изменилось → ссылка прежняя → мемо-компонент не перерисовывается;
//   • изменилось    → новая ссылка   → перерисовывается только эта строка.
//
// Домена ядро не знает: работает с любыми сущностями, у которых есть id.

/** `Object.hasOwn` — ES2022, а тут target/lib ES2020 (tsconfig.json). */
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/**
 * Структурное сравнение. Значения — JSON-совместимые (то, что приходит с бэка).
 * Экспортирован: тот же приём нужен точечным patch-путям вне reconcileById
 * (напр. `dialogsManager.patchDialog` — no-op `patch` не должен публиковаться,
 * если смерженные поля структурно совпали с текущим значением).
 */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => equal(v, b[i]))
  }

  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  if (ak.length !== Object.keys(bo).length) return false
  return ak.every((k) => hasOwn(bo, k) && equal(ao[k], bo[k]))
}

/** Одна сущность: прежняя ссылка, если ничего не изменилось. */
export function reconcileEntity<T>(prev: T | undefined, next: T): T {
  if (prev === undefined) return next
  return equal(prev, next) ? prev : next
}

export interface ReconcileResult<T> {
  /** Итоговый список. Если ничего не изменилось — ИСХОДНЫЙ массив по ссылке. */
  list: T[]
  added: T[]
  updated: T[]
  removed: T[]
  changed: boolean
}

/**
 * Свести `next` с `prev` по id. Порядок итога — из `next`: сортировку решает
 * вызывающий (для диалогов это индекс, для папок — localId).
 */
export function reconcileById<T>(
  prev: readonly T[],
  next: readonly T[],
  key: (e: T) => number | string,
): ReconcileResult<T> {
  const prevByKey = new Map<number | string, T>()
  for (const e of prev) prevByKey.set(key(e), e)

  const added: T[] = []
  const updated: T[] = []
  const list: T[] = []
  let changed = prev.length !== next.length

  next.forEach((incoming, i) => {
    const k = key(incoming)
    const old = prevByKey.get(k)
    const merged = reconcileEntity(old, incoming)
    list.push(merged)

    if (old === undefined) added.push(merged)
    else if (merged !== old) updated.push(merged)

    // порядок тоже изменение: строка переехала
    if (!changed && prev[i] !== merged) changed = true
    prevByKey.delete(k)
  })

  const removed = [...prevByKey.values()]
  if (removed.length) changed = true

  // Ничего не изменилось — отдаём ИСХОДНЫЙ массив: новая ссылка на массив
  // перерисовала бы всех подписчиков списка впустую.
  return { list: changed ? list : (prev as T[]), added, updated, removed, changed }
}
