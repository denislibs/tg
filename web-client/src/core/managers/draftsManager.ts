// Облачные черновики (tweb appDraftsManager поверх messages.saveDraft/
// getAllDrafts/clearAllDrafts): REST-часть в воркере; пустой текст на save
// удаляет черновик на бэке (draftMessageEmpty).
import type { RestClient } from '../net/restClient'
import type { DraftMessage, MessageEntity, RawDraft } from '../models'

export function newDraftsManager({ rest }: { rest: RestClient }) {
  return {
    // Витрина отвечает теми же КАДРАМИ, что приезжают живыми
    // (`messages.getAllDrafts` у оригинала — контейнер `Updates`), и применяет
    // их тот же владелец: черновик это поле диалога. Маппера нет — форма
    // провода и форма модели совпали.
    async list(): Promise<RawDraft[]> {
      const r = await rest.get<{ drafts: RawDraft[] }>('/drafts')
      return r.drafts ?? []
    },

    async save(peerId: number, text: string, replyToId?: number | null, entities?: MessageEntity[]): Promise<DraftMessage> {
      const r = await rest.put<{ draft: DraftMessage }>(`/chats/${peerId}/draft`, {
        text, entities: entities ?? null, reply_to_id: replyToId ?? null,
      })
      // «Снят» приезжает КОНСТРУКТОРОМ draftMessageEmpty, а не null.
      return r.draft
    },

    async delete(peerId: number): Promise<void> {
      await rest.del(`/chats/${peerId}/draft`)
    },

    async clearAll(): Promise<void> {
      await rest.del('/drafts')
    },
  }
}
