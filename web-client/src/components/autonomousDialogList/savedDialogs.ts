// Порт tweb `src/components/autonomousDialogList/savedDialogs.ts` (812502980, 67 строк):
// список сохранённых диалогов «Избранного» — источники сохранённых сообщений. Его
// строит вкладка «Чаты» правой колонки (`AppSearchSuper.loadSavedDialogs`,
// `appSearchSuper.ts:2214-2265`) поверх `SortedDialogList` с `virtualFilterId: myId`:
// строка — свой пир с источником в `threadId` (`DialogElement`, С10 шапки раздела
// «СТРОКА ДИАЛОГА» `lib/appDialogsManager.ts`). Задача 1-7 волны 7.
//
// Расхождения с оригиналом:
//  1. Страница — ответ `chats.savedDialogs` (`GET /saved/dialogs`), а не
//     `dialogsStorage.getDialogs({filterId: myId})` базы (`base.ts:238-249`):
//     хранилища сохранённых диалогов у нас нет, набор приезжает ЦЕЛИКОМ одним
//     ответом без курсора (`backend/internal/domain/mtsaveddialog.go`,
//     `NewMessagesSavedDialogs`). Поэтому страница одна (`isEnd: true`), а
//     догрузка с курсором отдаёт пустую.
//  2. Индекс — место в ответе владельца (порядок сервера: свежий источник выше),
//     а не `index_0` хранилища (`getDialogIndex`): считать индекс по дате на
//     главном потоке нельзя (`stores/noManualOrder.test.ts`), а порядок ответа и
//     есть порядок оригинала.
//  3. Сам диалог строки и её индекс `SortedDialogList` берёт у этой страницы
//     (`getDialog`, расхождение 6 `components/sortedDialogList.ts`).
//  4. Живых апдейтов (`dialogs_multiupdate` с `saved`, `dialog_drop`, `:22-43`)
//     нет: событий сохранённых диалогов на главном потоке нет, их хранилища в
//     воркере — тоже (`// О-112 волна 7`). Список собирается заново на каждый
//     первый показ вкладки.
//  5. `getRectFromForPlaceholder`, `getDialogFromElement` и
//     `attachPinnedReorder` — их потребителей у нас нет: прямоугольник канваса
//     наш `DialogsPlaceholder` берёт сам (расхождение 4 базы), меню строки и
//     перестановка закрепов сохранённых диалогов — `// О-111 волна 7` (ни
//     закрепа, ни удаления сохранённого диалога на бэкенде нет).
//  6. Менеджеры: база берёт менеджеры колонки у владельца (`appDialogsManager.managers`),
//     а ручки «Избранного» в них нет — её приносит вызывающий
//     (`AppSearchSuper.managers.chats`). У оригинала все менеджеры — `rootScope.managers`.
//  7. `destroy()` не роняет скроллер: он чужой — общий скроллер панели профиля,
//     им владеет хук `core/hooks/useSearchSuper.ts` (расхождение 7 шапки
//     `components/appSearchSuper.ts`). У оригинала `base.destroy()` зовёт
//     `scrollable.destroy()` и у этого списка (`base.ts:420-426`), снимая со
//     скроллера панели и её собственные колбэки.
//  8. `getCount()` — число строк полученной страницы. У оригинала счётчик вкладки
//     читает хранилище (`getDialogs({filterId: myId}).count`, `appSearchSuper.ts:2244-2247`);
//     у нас повторный вопрос был бы вторым запросом того же набора.
import type { Managers } from '@/client/bootstrap'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import type { SavedDialog } from '@lib/appDialogsManager'
import rootScope from '@lib/rootScope'
import { AutonomousDialogListBase, type BaseConstructorArgs } from '@components/autonomousDialogList/base'

/** Ручка «Избранного» — расхождение 6. */
export type SavedDialogListManagers = {
  chats: Pick<Managers['chats'], 'savedDialogs'>,
}

type ConstructorArgs = BaseConstructorArgs & {
  managers: SavedDialogListManagers,
}

export class AutonomousSavedDialogList extends AutonomousDialogListBase<SavedDialog> {
  public onAnyUpdate?: () => void

  private savedManagers: SavedDialogListManagers
  /** страница владельца по ключу-источнику — расхождения 1–3 */
  private dialogs = new Map<PeerId, SavedDialog>()
  private countPromise: CancellablePromise<number> = deferredPromise<number>()

  constructor({ managers, ...args }: ConstructorArgs) {
    super(args)
    this.savedManagers = managers
  }

  /** tweb `:52-54` */
  protected getFilterId() {
    return rootScope.myId
  }

  /** tweb `:56-58` */
  public getDialogKey(dialog: SavedDialog) {
    return dialog.savedPeerId
  }

  /** tweb `:60-64` */
  public getDialogKeyFromElement(element: HTMLElement) {
    // * a sublist is rendered as a row of our own peer with the saved peer as its thread, so the
    // * key (the saved peer id, as `getDialogKey` gives it) is the thread - the peer id is ours
    return +element.dataset.threadId!
  }

  /** расхождение 2 */
  protected getDialogIndex(dialog: SavedDialog) {
    return dialog.index
  }

  /** расхождение 3 */
  public getDialog(key: PeerId) {
    return this.dialogs.get(key)
  }

  /** расхождение 8 */
  public getCount() {
    return this.countPromise
  }

  /** расхождение 1 */
  protected async dialogsFetcher(offsetIndex: number | undefined) {
    if(offsetIndex !== undefined) {
      return { dialogs: [], count: this.dialogs.size, isEnd: true }
    }

    const page = await this.savedManagers.chats.savedDialogs()
    const myId = rootScope.myId
    const dialogs = page.map(({ peerId, lastMessage }, idx): SavedDialog => ({
      _: 'savedDialog',
      peerId: myId,
      savedPeerId: peerId,
      index: page.length - idx,
      lastMessage,
    }))

    this.dialogs = new Map(dialogs.map((dialog) => [dialog.savedPeerId, dialog]))
    this.countPromise.resolve!(dialogs.length)

    return { dialogs, count: dialogs.length, isEnd: true }
  }

  /** расхождение 7 */
  public destroy() {
    this.clear()
    this.listenerSetter.removeAll()
    this.middlewareHelper.destroy()
    this.sortedList?.destroy()
  }
}
