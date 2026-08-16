// Размер страницы списка диалогов — порт tweb
// `components/autonomousDialogList/base.ts:23,216-219`.
//
// Отдельный модуль (а не экспорт из хука-потребителя): чистые константы и
// функции без React. `guessLoadCount()` читает `core/hooks/useDialogListSource.ts`
// (размер страницы догрузки), `DIALOG_LOAD_COUNT` — владелец списка
// (`core/managers/dialogsManager.ts::doRefresh`: окно первичной загрузки на
// пустом кэше) и тест холодного старта `client/boot.firstPage.test.tsx`, где
// это граница «первая страница / остальной список». Сам `client/boot.ts`
// размера страницы не знает вовсе: он зовёт `refresh()`, а тот страничный.

/** `DIALOG_LOAD_COUNT` — константа tweb `base.ts:23`. */
export const DIALOG_LOAD_COUNT = 20

/**
 * Порт `base.ts:216-219`, формула дословно (`windowSize.height` у нас —
 * `window.innerHeight`): «чтобы скролл был даже на очень большом экране».
 */
export function guessLoadCount(): number {
  return Math.max(window.innerHeight / 64 * 1.25 | 0, DIALOG_LOAD_COUNT)
}
