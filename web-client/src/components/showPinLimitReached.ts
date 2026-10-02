// Порт tweb `src/components/showPinLimitReached.ts` (33 строки) — закреп не
// случился, потому что список полон; каждый вид списка говорит это по-своему.
// Любая другая ошибка — не про лимит, её не трогаем.
//
// Расхождения:
//  1. О-87 волна 7: имя отказа на проводе — `pin limit reached`
//     (`group_handler.go:590-591`, `domain.ErrPinLimit`), а не
//     `PINNED_DIALOGS_TOO_MUCH`/`PINNED_TOO_MUCH`; пока бэкенд не отдаёт имя
//     оригинала, наш текст считается тем же отказом.
//  2. О-87 волна 7: `showLimitPopup('pin')` (`popups/limit`) не портирован (нет
//     ни лимитов, ни `PopupLimit` — расхождение 9 `lib/appDialogsManager.ts`):
//     ВРЕМЕННО до О-87 «Все чаты»/архив говорят тостом пользовательской папки.
//  3. Опции `{filterId, isSaved, isTopic}` не принимаются: ветки по ним — тост
//     пользовательской папки (закреп в папке — О-70), `showLimitPopup('savedPin')`
//     и тост `LimitReachedPinnedTopics` (сохранённые диалоги и темы строкой —
//     задачи 1-7 и 1-6) — сводятся к одному тосту из п. 2.
//  4. Отказ из воркера приходит `Error` с полем `type` (`rpc/superMessagePort.ts`,
//     ветка `result`), а не `ApiError`.
import { toastNew } from '@components/toast'

export default function showPinLimitReached(err: unknown) {
  const type = (err as { type?: string } | undefined)?.type
  if(type !== 'PINNED_DIALOGS_TOO_MUCH' && type !== 'PINNED_TOO_MUCH' &&
    type !== 'pin limit reached') { // О-87 волна 7 — расхождение 1
    return
  }

  toastNew({ langPackKey: 'PinFolderLimitReached' }) // О-87 волна 7 — расхождение 2
}
