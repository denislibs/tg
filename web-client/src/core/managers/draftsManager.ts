// src/core/managers/draftsManager.ts
//
// Облачные черновики — порт tweb `appDraftsManager` (`lib/appManagers/
// appDraftsManager.ts`, 812502980) поверх `PUT /chats/{p}/draft`
// (`messages.saveDraft`), `GET /drafts` (`messages.getAllDrafts`) и
// `DELETE /drafts` (`messages.clearAllDrafts`).
//
// Ключ черновика — пара «пир + тред» (`getKey`, `:88-90`): тред темы форума
// (General — `GENERAL_TOPIC_ID`) или комментариев (номер зеркала поста). Тред на
// проводе едет в `reply_to` (`syncDraft`, `:296-303`), кадр `updateDraftMessage`
// несёт его в `top_msg_id`.
//
// Расхождения с оригиналом:
//  1. Черновик ЧАТА (без треда) живёт полем диалога у владельца списка
//     (`dialogsManager.applyDraft`, `core/dialogs/draft.ts`), а не в словаре
//     здесь: от его даты зависит место строки, и второй копии не заводим. Словарь
//     держит черновики тредов. Поэтому у черновика чата нет местной записи в
//     `syncDraft` — строка диалога меняется кадром сервера, сравнение с ней
//     делает поле ввода (`ChatInput.saveDraft`, расхождение 3 его шапки); и
//     `clearDraft` — только у треда.
//  2. Словарь живёт в памяти, на диск не пишется (`appStateManager.storage
//     'drafts'`, `:74-76`, `:165-167`): после перезапуска его наполняет
//     `getAllDrafts` (`addMissedDialogs`) и строки тем (`forumTopic.draft`).
//  3. Ответ `saveDraft` — `Bool`; диалог, заведённый черновиком (`:319-324`,
//     `reloadConversation`), после ответа не перечитывается — его заводит кадр
//     сервера (`dialogs.applyDraft` перечитывает строку чата, которой нет в
//     списке, как слушатель `draft_updated`, `appMessagesManager.ts:895-899`).
//  4. Монофорумов и `media`/`no_webpage`/`invert_media` черновика (`:281-291`)
//     нет: ручка этих полей не принимает (Б-72 — превью ссылки без черновика).
//  5. Своё сохранение сервер присылает эхом и этому устройству (кадр всем
//     устройствам владельца; у оригинала эха своей сессии нет). Эхо, равное
//     уже записанному, ничего не объявляет; эхо черновика, который отправка
//     уже сняла (`clearDraft`), не возвращает его — его снимет кадр очистки
//     сервера (тот же приём, что `clearedDraft` поля ввода у черновика чата).
//  6. ИСПРАВЛЕН баг оригинала `:66` (решение пользователя, В-6 спеки Ф-5): tweb
//     кладёт в ключ серверный `top_msg_id` без `generateMessageId`, а поле ввода
//     сравнивает его с клиентским `threadId` (`input.ts:1718`) — черновик треда с
//     другого устройства и из `getAllDrafts` у tweb не применяется.
import type { RestClient } from '../net/restClient'
import type { DraftMessage, DraftMessageReal, MessageEntity, RawDraft } from '../models'
import { getPeerId } from '../peers/peerId'
import { generateMessageId, getServerMessageId, isLocalMessageId } from '../history/messageId'
import { draftsAreEqual, processApiDraft, realDraft } from '../dialogs/draft'
import tsNow from '@helpers/tsNow'

/** `draft_updated` (tweb `rootScope.ts:162`) — вкладкам. */
export interface DraftUpdatedEvt {
  peerId: PeerId
  threadId?: number
  draft: DraftMessageReal | undefined
  force?: boolean
}

/** Тело `PUT /chats/{p}/draft` — TL `messages.saveDraft` без `peer`. */
interface SaveDraftParams {
  message: string
  entities?: MessageEntity[]
  reply_to?: { _: 'inputReplyToMessage'; reply_to_msg_id?: number; top_msg_id?: number }
}

export interface DraftsDeps {
  rest: Pick<RestClient, 'get' | 'put' | 'del'>
  /** Черновик чата — поле диалога (расхождение 1). */
  applyDialogDraft?: (peerId: PeerId, draft: DraftMessage) => void
  /** Черновик треда в строке темы форума — ветка `getAnyDialog(peerId, threadId)`
   *  слушателя `draft_updated` (tweb `appMessagesManager.ts:858-901`). */
  applyTopicDraft?: (peerId: PeerId, topicId: number, draft: DraftMessageReal | undefined) => void
  /** `rootScope.dispatchEvent('draft_updated', …)` (`:171-177`). */
  onDraftUpdated?: (e: DraftUpdatedEvt) => void
}

export function newDraftsManager({ rest, applyDialogDraft, applyTopicDraft, onDraftUpdated }: DraftsDeps) {
  /** tweb `drafts` (`:36`) — черновики тредов (расхождение 1). */
  const drafts = new Map<string, DraftMessageReal>()
  /** Снятые отправкой черновики тредов — расхождение 5. */
  const clearedDrafts = new Map<string, DraftMessageReal>()
  let getAllDraftPromise: Promise<void> | undefined

  /** tweb `getKey` (`:88-90`) */
  const getKey = (peerId: PeerId, threadId?: number) => '' + peerId + (threadId ? '_' + threadId : '')

  /** tweb `isEmptyDraft` (`:183-197`) */
  function isEmptyDraft(draft: DraftMessage | undefined): boolean {
    if (draft?._ !== 'draftMessage') return true
    if (draft.reply_to !== undefined && draft.reply_to.reply_to_msg_id > 0) return false
    return !draft.message.length
  }

  /** tweb `saveDraft` (`:141-181`) — для треда; черновик чата — его диалогу. */
  function saveDraft({ peerId, threadId, draft: apiDraft, notify, force }: {
    peerId: PeerId; threadId?: number; draft: DraftMessage | undefined; notify?: boolean; force?: boolean
  }): DraftMessageReal | undefined {
    const draft = realDraft(processApiDraft(apiDraft))
    if (!threadId) {
      // расхождение 1
      applyDialogDraft?.(peerId, apiDraft ?? { _: 'draftMessageEmpty' })
      return draft
    }

    const key = getKey(peerId, threadId)
    if (draft) drafts.set(key, draft)
    else drafts.delete(key)

    if (notify) {
      // слушатель `draft_updated` в `appMessagesManager` (:858-901) — строка темы
      applyTopicDraft?.(peerId, threadId, draft)
      onDraftUpdated?.({ peerId, threadId, draft, force })
    }

    return draft
  }

  /** tweb `getAllDrafts` (`:131-139`): тот же контейнер `Updates`, что приезжает кадрами. */
  function getAllDrafts(): Promise<void> {
    return getAllDraftPromise ??= rest.get<{ _: 'updates'; updates?: RawDraft[] }>('/drafts').then((r) => {
      for (const update of r.updates ?? []) applyUpdate(update)
    }, (err: unknown) => {
      getAllDraftPromise = undefined
      throw err
    })
  }

  /** `updateDraftMessage` — tweb `:44-71`. */
  function applyUpdate(update: RawDraft): void {
    const peerId = getPeerId(update.peer)
    // ИСПРАВЛЕНО (расхождение 6 шапки): tweb `:66` кладёт серверный
    // `top_msg_id` как есть, а ключ треда — клиентский номер
    // (`appMessagesIdsManager.generateMessageId(top_msg_id, channelId)`).
    const threadId = update.top_msg_id ? generateMessageId(update.top_msg_id) : undefined
    if (threadId) {
      // расхождение 5 — эхо своего сохранения
      const key = getKey(peerId, threadId)
      const next = realDraft(processApiDraft(update.draft))
      const cleared = clearedDrafts.get(key)
      if (!next) clearedDrafts.delete(key)
      else if (cleared && draftsAreEqual(next, cleared)) return
      if (draftsAreEqual(drafts.get(key), next)) {
        if (next) drafts.set(key, next)
        return
      }
    }
    saveDraft({ peerId, threadId, draft: update.draft, notify: true })
  }

  return {
    applyUpdate,

    /** tweb `getDraft` (`:92-94`) — черновик треда (расхождение 1). */
    getDraft(peerId: PeerId, threadId: number): DraftMessageReal | undefined {
      return drafts.get(getKey(peerId, threadId))
    },

    /** Черновик темы из ответа списка тем — `dialogs.ts:1692-1697` (`saveDraft`
     *  без `notify`): тот же словарь, что у поля ввода. */
    saveTopicDraft(peerId: PeerId, topicId: number, draft: DraftMessage | undefined): DraftMessageReal | undefined {
      return saveDraft({ peerId, threadId: topicId, draft })
    },

    /** tweb `addMissedDialogs` (`:109-129`) — `getAllDrafts` один раз за сессию. */
    addMissedDialogs(): Promise<void> {
      return getAllDrafts()
    },

    /**
     * tweb `syncDraft` (`:216-330`): сравнить с известным, у треда — записать
     * местно и объявить (`draft_updated`), отправить серверу. Тред едет в
     * `reply_to` (`:296-303`): без ответа — `reply_to_msg_id = тред`, с
     * ответом — `top_msg_id = тред`.
     */
    async syncDraft({ peerId, threadId, localDraft, force = false }: {
      peerId: PeerId; threadId?: number; localDraft: DraftMessageReal | undefined; force?: boolean
    }): Promise<unknown> {
      if (threadId && draftsAreEqual(drafts.get(getKey(peerId, threadId)), localDraft)) return true
      if (threadId) clearedDrafts.delete(getKey(peerId, threadId))

      const params: SaveDraftParams = { message: '' }
      let draftObj: DraftMessage | undefined
      if (isEmptyDraft(localDraft)) {
        draftObj = { _: 'draftMessageEmpty' }
      } else {
        const draft = localDraft!
        const replyTo = draft.reply_to
        // `isEphemeralReply` (:249-255) — ответ на неотправленное
        if (replyTo && !isLocalMessageId(replyTo.reply_to_msg_id)) {
          params.reply_to = { _: 'inputReplyToMessage', reply_to_msg_id: getServerMessageId(replyTo.reply_to_msg_id) }
        }
        if (draft.entities?.length) params.entities = draft.entities
        params.message = draft.message
      }

      if (threadId) {
        const inputReplyTo = params.reply_to ??= { _: 'inputReplyToMessage' }
        if (!inputReplyTo.reply_to_msg_id) inputReplyTo.reply_to_msg_id = getServerMessageId(threadId)
        else inputReplyTo.top_msg_id = getServerMessageId(threadId)

        const saveLocalDraft: DraftMessage = draftObj ?? { ...localDraft!, date: tsNow(true) }
        saveDraft({ peerId, threadId, draft: saveLocalDraft, notify: true, force })
      }

      return rest.put(`/chats/${peerId}/draft`, params)
    },

    /** tweb `clearDraft` (`:353-371`) — местное снятие черновика треда
     *  отправкой (`sendText({clearDraft})`); у чата — расхождение 1. */
    clearDraft(peerId: PeerId, threadId: number): void {
      const key = getKey(peerId, threadId)
      const draft = drafts.get(key)
      // снимать нечего — у оригинала `syncDraft` гасит равное (:219-222)
      if (!draft) return
      clearedDrafts.set(key, draft)
      saveDraft({ peerId, threadId, draft: { _: 'draftMessageEmpty' }, notify: true, force: true })
    },

    /** tweb `clearAllDrafts` (`:332-351`): черновики тредов снимаются здесь,
     *  черновики чатов — кадрами сервера. */
    async clearAll(): Promise<void> {
      await rest.del('/drafts')
      for (const key of drafts.keys()) {
        const [peerId, threadId] = key.split('_')
        saveDraft({ peerId: +peerId, threadId: +threadId, draft: undefined, notify: true })
      }
    },

    /** Смена сессии — у оригинала `clear()` (`:79-86`). */
    reset(): void {
      drafts.clear()
      clearedDrafts.clear()
      getAllDraftPromise = undefined
    },
  }
}

export type DraftsManager = ReturnType<typeof newDraftsManager>
