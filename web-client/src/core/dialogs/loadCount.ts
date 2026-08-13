// Размер страницы списка диалогов — порт tweb
// `components/autonomousDialogList/base.ts:23,216-219`.
//
// Отдельный модуль (а не экспорт из хука-потребителя): страницу просит не
// только виртуальный список (`core/hooks/useDialogListSource.ts`), но и точка
// входа `client/boot.ts` — тянуть в неё React-хук ради двух чистых функций
// незачем.

/** `DIALOG_LOAD_COUNT` — константа tweb `base.ts:23`. */
export const DIALOG_LOAD_COUNT = 20

/**
 * Порт `base.ts:216-219`, формула дословно (`windowSize.height` у нас —
 * `window.innerHeight`): «чтобы скролл был даже на очень большом экране».
 */
export function guessLoadCount(): number {
  return Math.max(window.innerHeight / 64 * 1.25 | 0, DIALOG_LOAD_COUNT)
}
