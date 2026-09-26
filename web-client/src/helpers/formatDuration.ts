// Порт tweb `src/helpers/formatDuration.ts:1-9` (812502980) — разряды длительности.
// Сама `formatDuration` (`:11-54`, разложение секунд на разряды) не портирована:
// потребителя нет — «Данные и память» строит подписи срока кэша готовыми парами
// `{duration, type}` (`storageQuota.tsx:143-165`).
export enum DurationType {
  Seconds,
  Minutes,
  Hours,
  Days,
  Weeks,
  Months,
  Years,
}

/** Тип результата `formatDuration` у tweb (`:18`). */
export type FormattedDuration = { duration: number, type: DurationType }[]
