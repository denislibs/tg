// Облачные черновики (tweb appDraftsManager поверх messages.saveDraft/
// getAllDrafts/clearAllDrafts): REST-часть в воркере; пустой текст на save
// удаляет черновик на бэке (draftMessageEmpty).
import type { RestClient } from '../net/restClient'
import { mapDraft, type Draft, type MessageEntity, type RawDraft } from '../models'

export function newDraftsManager({ rest }: { rest: RestClient }) {
  return {
    async list(): Promise<Draft[]> {
      const r = await rest.get<{ drafts: RawDraft[] }>('/drafts')
      return (r.drafts ?? []).map(mapDraft)
    },

    async save(chatId: number, text: string, replyToId?: number | null, entities?: MessageEntity[]): Promise<Draft | null> {
      const r = await rest.put<{ draft: RawDraft | null }>(`/chats/${chatId}/draft`, {
        text, entities: entities ?? null, reply_to_id: replyToId ?? null,
      })
      return r.draft ? mapDraft(r.draft) : null
    },

    async delete(chatId: number): Promise<void> {
      await rest.del(`/chats/${chatId}/draft`)
    },

    async clearAll(): Promise<void> {
      await rest.del('/drafts')
    },
  }
}
