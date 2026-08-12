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
import type { NewMessageEvt, ReadEvt, ChatUpdateEvt } from '../realtime/events'

/** Наше закрепление пер-юзерное и на весь список сразу — запись одна (см. chatsStore). */
const ALL_FOLDER_ID = 0

export interface DialogsDeps {
  rest: Pick<RestClient, 'get'>
  onDialogOps?: (ops: DialogOp[]) => void
  /** офлайн-кэш прошлой сессии (persist.loadDialogs) */
  loadCache: () => Promise<Dialog[]>
  /** ключи State, от которых зависит порядок (persist.loadStateAll) */
  loadState: () => Promise<{ pinnedOrders: Record<number, number[]>; drafts: Draft[] }>
  /** id текущего пользователя — нужен applyNewMessage (не бампить бейдж на своё же
   * эхо). Разрешается лениво (воркер узнаёт `me` асинхронно), поэтому геттер, а не
   * значение — тот же приём, что у `newMessagesManager` (messagesManager.ts). */
  getMeId?: () => number | null
}

export function newDialogsManager({ rest, onDialogOps, loadCache, loadState, getMeId }: DialogsDeps) {
  let items: DialogItem[] = []
  let pinnedOrder: number[] = []
  let drafts: Draft[] = []
  let hydrated = false
  // Промис гидратации в полёте (а не булев флаг): конкурентный fillMirror()/
  // refresh() — две вкладки поднимают общий SharedWorker одновременно, либо оба
  // метода зовутся почти сразу друг за другом — обязан ждать РЕЗУЛЬТАТ первого
  // вызова, а не проскакивать мимо него. Флаг `hydrated=true`, выставленный
  // синхронно ДО await, давал второму вызову увидеть «уже гидратировано» и
  // разослать пустой reset раньше, чем первый успел загрузить кэш/State — этот
  // дефект воспроизведён и закрыт тестом «конкурентный fillMirror не рассылает
  // пустой reset» (dialogsManager.test.ts). `null` после промаха — гидратация
  // упавшая (оффлайн/битый IDB) обязана даться повторить, а не залипнуть на
  // вечно отклонённом промисе (см. тест «упавшая гидратация не залипает»).
  let hydrating: Promise<void> | null = null

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

  const findDialog = (chatId: number): Dialog | undefined => items.find((i) => i.dialog.chatId === chatId)?.dialog

  /**
   * Точечно смержить `fields` в один диалог кэша и опубликовать `patch`. Индекс
   * пересчитывается той же чистой `dialogIndex()` — если он не сдвинулся, `index`
   * в операции не участвует (зеркало просто накладывает `fields` на месте).
   *
   * Диалога нет в кэше — не ошибка (Task 3, «Осторожно» #3): молча выходим, как
   * раньше выходил `if (!cur) return {}` в chatsStore — он приедет со следующей
   * загрузкой/reset'ом.
   */
  function patchDialog(chatId: number, fields: Partial<Dialog>): void {
    const idx = items.findIndex((i) => i.dialog.chatId === chatId)
    if (idx === -1) return
    const dialog: Dialog = { ...items[idx].dialog, ...fields }
    const index = dialogIndex(dialog, pinnedOrder, draftFor(chatId))
    const moved = index !== items[idx].index
    items[idx] = { dialog, index }
    if (moved) items = [...items].sort((a, b) => b.index - a.index)
    publish([{ op: 'patch', chatId, fields, ...(moved ? { index } : {}) }])
  }

  async function doHydrate(): Promise<void> {
    const state = await loadState()
    pinnedOrder = state.pinnedOrders[ALL_FOLDER_ID] ?? []
    drafts = state.drafts
    if (!items.length) setAll(await loadCache())
    hydrated = true
  }

  function hydrate(): Promise<void> {
    if (hydrated) return Promise.resolve()
    hydrating ??= doHydrate().finally(() => { hydrating = null })
    return hydrating
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

    // ── Task 3: realtime-кадры применяет владелец ────────────────────────────
    // Тела перенесены из chatsStore КАК ЕСТЬ (fallback `unread ?? +1`,
    // идемпотентность `applyRead`, абсолютный снимок `chat_update`); меняется
    // только выход — вместо `set({dialogs})` публикуем `patch`/`remove`.

    /** Новое сообщение (live `new_message`) поднимает диалог и бампит превью/unread. */
    applyNewMessage(e: NewMessageEvt): void {
      const cur = findDialog(e.chat_id)
      if (!cur) return // unknown chat (приедет на следующей reset-загрузке)
      const meId = getMeId?.() ?? null
      // Wave 3: сервер шлёт авторитетный unread получателям — берём verbatim; локальный
      // +1 остаётся fallback (старый бэк без поля). Своё же эхо (sender_id===meId,
      // включая другие вкладки/устройства) бейдж не бампит — у отправителя поле
      // `unread` в кадре и не приходит (backend message.go: `if uid != in.SenderID`).
      //
      // Отступление от прежнего main-кода (chatsStore.applyNewMessage): там ещё
      // проверялся `activeChatId`, чтобы не бампить бейдж для открытого на ЭТОЙ
      // вкладке чата. Воркер общий на все вкладки и какая из них что смотрит —
      // не знает; `activeChatId` — эфемерика, остаётся на main (докблок
      // ChatsState.activeChatId, спека docs/superpowers/specs/2026-08-12-
      // dialogs-ownership-and-virtual-list-design.md, «Что остаётся на main»).
      // Блип бейджа для открытого чата гасит немедленный markRead активной вкладки.
      const incoming = e.sender_id !== meId
      const nextUnread = incoming ? (e.unread ?? cur.unread + 1) : cur.unread
      patchDialog(e.chat_id, {
        lastMessage: {
          seq: e.seq,
          text: e.text,
          senderId: e.sender_id,
          at: e.created_at,
          mediaId: e.media_id ?? undefined,
          mediaType: e.type || undefined,
          senderName: e.sender_name || undefined,
          forwarded: e.fwd_from_user_id != null || e.fwd_from_chat_id != null || undefined,
        },
        unread: nextUnread,
      })
    },

    /** `read` — моё прочтение гасит unread/горизонт, чужое двигает peerReadSeq (✓✓). */
    applyRead(e: ReadEvt, meId: number | null): void {
      const cur = findDialog(e.chat_id)
      if (!cur) return
      if (e.user_id === meId) {
        // Wave 3: авторитетный unread из кадра verbatim (обычно 0); локальный =0 — fallback.
        const unread = e.unread ?? 0
        const lastReadSeq = Math.max(cur.lastReadSeq, e.up_to_seq)
        // Идемпотентность: повторное эхо того же прочтения (up_to_seq ≤ горизонта,
        // unread уже 0) НЕ публикует операцию — иначе на зеркале перезапустится
        // mark-read-эффект (деп win.msgs) и получится бесконечный цикл ре-рендера.
        if (unread === cur.unread && cur.unreadMentions === 0 && cur.unreadReactions === 0 && lastReadSeq === cur.lastReadSeq) return
        patchDialog(e.chat_id, { unread, unreadMentions: 0, unreadReactions: 0, lastReadSeq })
      } else {
        // the OTHER side read my messages → advance the peer horizon (out ticks → ✓✓)
        const peerReadSeq = Math.max(cur.peerReadSeq, e.up_to_seq)
        if (peerReadSeq === cur.peerReadSeq) return // no advance → no-op (без операции)
        patchDialog(e.chat_id, { peerReadSeq })
      }
    },

    // Бэкенд шлёт в `chat_update` АБСОЛЮТНЫЙ снимок метаданных чата
    // (backend/internal/usecase/chat/chat_update.go:18-42) — сливаем его в
    // существующий диалог, в сеть за списком не ходим.
    applyChatMeta(e: ChatUpdateEvt): void {
      const cur = findDialog(e.chat_id)
      if (!cur) return // чата нет в списке — приедет со следующей загрузкой
      // Пишем только те поля, что реально пришли в снимке: '' и null — это
      // «сброшено» (снимок абсолютный), отсутствие ключа — «не про это событие».
      const fields: Partial<Dialog> = {
        ...(e.title !== undefined && { title: e.title }),
        // username кладём verbatim — ровно как маппинг ответа /chats (models.ts:675).
        ...(e.username !== undefined && { username: e.username }),
        ...(e.photo_media_id !== undefined && {
          // Тот же путь, что отдаёт /chats (backend chatsrepo.go:190) — НЕ готовый
          // URL с медиа-токеном: токен живёт ~15 минут, в долгоживущую модель его класть нельзя.
          photoUrl: e.photo_media_id === null ? undefined : `/media/${e.photo_media_id}/content`,
        }),
      }
      patchDialog(e.chat_id, fields)
    },

    // Кто-то поставил реакцию на МОЁ сообщение → бампим бейдж непрочитанных
    // реакций диалога (Telegram unread_reactions_count). Сброс — на applyRead.
    bumpUnreadReactions(chatId: number, count?: number): void {
      const cur = findDialog(chatId)
      if (!cur) return
      // Авторитетный счётчик из кадра (reaction.unread_reactions) — verbatim, как
      // unread у new_message/read; локальный +1 — fallback, если поля нет.
      const value = typeof count === 'number' ? count : (cur.unreadReactions ?? 0) + 1
      patchDialog(chatId, { unreadReactions: value })
    },

    // Меня удалили из группы / вышел сам (chat_removed) — диалог исчезает из списка.
    applyRemoved(chatId: number): void {
      const idx = items.findIndex((i) => i.dialog.chatId === chatId)
      if (idx === -1) return // не было в кэше — нечего убирать
      items = items.filter((i) => i.dialog.chatId !== chatId)
      publish([{ op: 'remove', chatId }])
    },
  }
}
export type DialogsManager = ReturnType<typeof newDialogsManager>
