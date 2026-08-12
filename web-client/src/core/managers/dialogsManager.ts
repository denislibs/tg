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
import { equal } from '../store/reconcile'

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
  /**
   * Task 4 (действия без оптимистики): `applyPinned` двигает порядок закреплённых
   * и обязан и записать новый `pinnedOrders` на диск, и разослать зеркало ключа
   * остальным вкладкам — тем же путём, что `persistManager.stateKey`
   * (`saveStateKey` + `mirrorStateKey` в workerCore.ts), второй писатель того же
   * ключа не заводится. Опциональны по тому же приёму, что `getMeId` выше: тесты,
   * которых `applyPinned` не касается, их не задают.
   */
  savePinnedOrders?: (value: Record<number, number[]>) => Promise<void>
  mirrorStateKey?: (key: string, value: unknown) => void
}

export function newDialogsManager({ rest, onDialogOps, loadCache, loadState, getMeId, savePinnedOrders, mirrorStateKey }: DialogsDeps) {
  let items: DialogItem[] = []
  // Полный State-ключ (все папки) — нужен целиком, чтобы applyPinned не затёр
  // чужие записи при записи на диск (порт tweb: `{...orders, [ALL_FOLDER_ID]: …}`,
  // см. прежний chatsStore.setDialogPinned). `pinnedOrder` — производная для
  // ТЕКУЩЕЙ (единственной) папки, ей пользуется dialogIndex().
  let pinnedOrders: Record<number, number[]> = {}
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
   *
   * Fix (ревью Task 3, Important): смерженный результат структурно совпал с
   * текущим значением (напр. бэкенд повторно шлёт идентичный `chat_update` —
   * `publishChatUpdate` зовётся из 13 мест бэка и прилетает КАЖДОМУ участнику
   * чата) — `patch` не публикуем вовсе. Раньше (main, chatsStore.applyChatMeta)
   * это давало бесплатно `reconcileEntity`/`reconcileById` (совпавший ответ
   * возвращает ИСХОДНЫЙ объект/массив); patch-путь владельца эту сверку не
   * делал и создавал новую ссылку на диалог/патчил зеркало (`chatsStore.ts`,
   * ветка `patch`: `{...d, ...op.fields}` МИМО `reconcileById`) при нулевом
   * изменении данных — лишний ре-рендер мемоизированного `ChatListItem`.
   * `equal()` — тот же структурный компаратор, что и в `reconcileEntity`.
   */
  function patchDialog(chatId: number, fields: Partial<Dialog>): void {
    const idx = items.findIndex((i) => i.dialog.chatId === chatId)
    if (idx === -1) return
    const prev = items[idx].dialog
    const dialog: Dialog = { ...prev, ...fields }
    if (equal(prev, dialog)) return
    const index = dialogIndex(dialog, pinnedOrder, draftFor(chatId))
    const moved = index !== items[idx].index
    items[idx] = { dialog, index }
    if (moved) items = [...items].sort((a, b) => b.index - a.index)
    publish([{ op: 'patch', chatId, fields, ...(moved ? { index } : {}) }])
  }

  async function doHydrate(): Promise<void> {
    const state = await loadState()
    pinnedOrders = state.pinnedOrders
    pinnedOrder = pinnedOrders[ALL_FOLDER_ID] ?? []
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
      if (key === 'pinnedOrders') {
        pinnedOrders = value as Record<number, number[]>
        pinnedOrder = pinnedOrders[ALL_FOLDER_ID] ?? []
      } else if (key === 'drafts') drafts = value as Draft[]
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

    // ── Task 4 (действия без оптимистики) ─────────────────────────────────────
    // Порт tweb: `invokeApi(...).then(saveUpdate)` — сеть уже подтвердила, ЗАТЕМ
    // применяем. Сетевые менеджеры (groupsManager/chatThemesManager) зовут эти
    // методы ПОСЛЕ успешного REST-ответа; при ошибке они не зовутся вовсе — см.
    // dialogsManager.test.ts «RPC упал — ни одной операции».

    /** Пер-чатовый mute (messages.setMute) — то же поле, что и realtime-эхо dialog_mute. */
    applyMute(chatId: number, muted: boolean): void {
      patchDialog(chatId, { muted })
    },

    /** В архив / из архива — пин сбрасывается (как на бэке, group_settings.go). */
    applyArchived(chatId: number, archived: boolean): void {
      patchDialog(chatId, { archived, pinned: false })
    },

    /** Тема оформления чата (messages.setChatTheme) — пустая строка сбрасывает к дефолту. */
    applyTheme(chatId: number, themeId: string): void {
      patchDialog(chatId, { themeId: themeId || undefined })
    },

    /**
     * Пин/анпин двигает и ПОРЯДОК: свежий пин встаёт первым (порт tweb
     * `order.unshift`, dialogs.ts:934), анпин выпадает из порядка. Порядок
     * закреплённых — общий State-ключ на весь список (см. докблок ALL_FOLDER_ID
     * выше и прежний chatsStore.setDialogPinned, откуда перенесена логика).
     * Пишем на диск и рассылаем зеркало ключа тем же путём, что
     * `persistManager.stateKey` (`saveStateKey` + `mirrorStateKey` в
     * workerCore.ts) — второй писатель того же ключа не заводится.
     *
     * Fix (ревью Task 4, Critical): пин/анпин — ФАКТ (булево поле диалога), а не
     * команда «переставь». `order.unshift` оправдан только при РЕАЛЬНОМ переходе
     * `pinned` false↔true; повторный/запоздавший кадр того же уже применённого
     * факта (собственное WS-эхо — бэкенд шлёт `dialog_pin` на ВСЕ соединения
     * пользователя, включая инициировавшее: `backend/internal/adapter/delivery/
     * ws/hub.go:203-209`, во фрейме нет id соединения, фильтровать нечем) не
     * должен трогать уже устоявшийся `pinnedOrder` — иначе чат, запиненный
     * РАНЬШЕ, задним числом обгоняет чат, запиненный ПОЗЖЕ (порядок событий:
     * apply(1,true) → apply(2,true) → запоздавшее эхо apply(1,true) снова
     * бросало бы 1 на вершину, ломая [2,1,…] обратно на [1,2,…]). Гвард —
     * ровно та же идея, что `equal()` в `patchDialog`: нечего менять — не
     * трогаем ни кэш, ни диск, ни зеркало.
     *
     * Отличимость от «легитимного перепина уже закреплённого чата» (чтобы
     * снова всплыть наверх): такого действия в продукте НЕТ — UI показывает
     * либо «Pin» у незакреплённого чата, либо «Unpin» у закреплённого
     * (`ChatListItem.tsx`: `chat.pinned ? 'Unpin' : 'Pin'`), кнопки «запинить
     * заново уже запиненный, чтобы поднять его» не существует ни у нас, ни в
     * tweb (порядок закреплённых меняется явным drag'ом, которого в этом
     * клиенте тоже нет). Единственный путь получить `applyPinned(id, true)` с
     * уже `pinned===true` — дубль/эхо ОДНОГО И ТОГО ЖЕ действия. Различить
     * «дубль» от «легитимного намерения поднять» по одним лишь текущим данным
     * (без монотонного номера действия в кадре) НЕЛЬЗЯ — если такая фича
     * появится, `dialog_pin` придётся снабдить версией/меткой времени.
     */
    applyPinned(chatId: number, pinned: boolean): void {
      const idx = items.findIndex((i) => i.dialog.chatId === chatId)
      if (idx === -1) return
      const cur = items[idx].dialog
      if (cur.pinned === pinned) return // факт уже применён — не переставляем и не пишем повторно
      const others = pinnedOrder.filter((id) => id !== chatId)
      pinnedOrder = pinned ? [chatId, ...others] : others
      pinnedOrders = { ...pinnedOrders, [ALL_FOLDER_ID]: pinnedOrder }
      void savePinnedOrders?.(pinnedOrders)
      mirrorStateKey?.('pinnedOrders', pinnedOrders)
      const dialog: Dialog = { ...cur, pinned }
      items = sort(items.map((i) => (i.dialog.chatId === chatId ? dialog : i.dialog)))
      publish([
        { op: 'patch', chatId, fields: { pinned } },
        { op: 'reindex', items: items.map((i) => ({ chatId: i.dialog.chatId, index: i.index })) },
      ])
    },
  }
}
export type DialogsManager = ReturnType<typeof newDialogsManager>
