// Владелец списка диалогов (порт модели tweb: dialogsStorage живёт в воркере
// вместе с generateDialogIndex, черновиками и порядком закреплённых).
// Витрина (`stores/chatsStore.ts`) — зеркало, её единственный писатель — проектор.
//
// Отступление от tweb: у них представление — сам DOM, которым владеет
// SortedDialogList, массива диалогов на main нет; у нас представление — React,
// читающий из стора, поэтому зеркало массивом. См. спеку
// docs/superpowers/specs/2026-08-12-dialogs-ownership-and-virtual-list-design.md.
import type { RestClient } from '../net/restClient'
import { HttpError } from '../net/restClient'
import { mapDialog, type Dialog, type Draft, type RawDialog } from '../models'
import { dialogIndex } from '../dialogs/dialogIndex'
import type { DialogItem, DialogOp } from '../dialogs/dialogOps'

/** Наше закрепление пер-юзерное и на весь список сразу — запись одна (см. chatsStore). */
const ALL_FOLDER_ID = 0

export interface DialogsDeps {
  rest: Pick<RestClient, 'get'>
  onDialogOps?: (ops: DialogOp[]) => void
  /** офлайн-кэш прошлой сессии (persist.loadDialogs) */
  loadCache: () => Promise<Dialog[]>
  /** ключи State, от которых зависит порядок (persist.loadStateAll) */
  loadState: () => Promise<{ pinnedOrders: Record<number, number[]>; drafts: Draft[] }>
}

export function newDialogsManager({ rest, onDialogOps, loadCache, loadState }: DialogsDeps) {
  let items: DialogItem[] = []
  let pinnedOrder: number[] = []
  let drafts: Draft[] = []
  let hydrated = false

  const publish = (ops: DialogOp[]) => onDialogOps?.(ops)
  const draftFor = (chatId: number) => drafts.find((d) => d.chatId === chatId)

  /** Порядок — производная от данных (tweb generateDialogIndex, dialogs.ts:605-608). */
  const sort = (dialogs: Dialog[]): DialogItem[] =>
    dialogs
      .map((dialog) => ({ dialog, index: dialogIndex(dialog, pinnedOrder, draftFor(dialog.chatId)) }))
      .sort((a, b) => b.index - a.index)

  const setAll = (dialogs: Dialog[]): DialogOp => {
    items = sort(dialogs)
    return { op: 'reset', items }
  }

  async function hydrate(): Promise<void> {
    if (hydrated) return
    hydrated = true
    const state = await loadState()
    pinnedOrder = state.pinnedOrders[ALL_FOLDER_ID] ?? []
    drafts = state.drafts
    if (!items.length) setAll(await loadCache())
  }

  return {
    /**
     * Зеркало объявило пробел. Отвечаем ВСЕГДА — и ответом RPC (его ждёт boot.ts
     * до первого рендера), и веером (соседние вкладки). «Уже публиковали» не
     * считается доставкой: SuperMessagePort кадры не буферизует.
     */
    async fillMirror(): Promise<DialogOp> {
      await hydrate()
      const op: DialogOp = { op: 'reset', items }
      publish([op])
      return op
    },

    /** Сетевой догон. Офлайн — молча остаёмся на кэше (как прежний listDialogs). */
    async refresh(): Promise<void> {
      await hydrate()
      try {
        const r = await rest.get<{ chats?: RawDialog[] }>('/chats')
        publish([setAll((r.chats ?? []).map(mapDialog))])
      } catch (e) {
        if (e instanceof HttpError) throw e
      }
    },

    getSnapshot: (): DialogItem[] => items,

    /**
     * Ключ State, от которого зависит порядок, изменился (пишет persistManager).
     * Значения диалогов те же — публикуем reindex, а не reset.
     */
    setStateKey(key: string, value: unknown): void {
      if (key === 'pinnedOrders') pinnedOrder = (value as Record<number, number[]>)[ALL_FOLDER_ID] ?? []
      else if (key === 'drafts') drafts = value as Draft[]
      else return
      items = sort(items.map((i) => i.dialog))
      publish([{ op: 'reindex', items: items.map((i) => ({ chatId: i.dialog.chatId, index: i.index })) }])
    },
  }
}
export type DialogsManager = ReturnType<typeof newDialogsManager>
