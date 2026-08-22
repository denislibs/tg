// Облачные черновики (tweb appDraftsManager поверх messages.saveDraft/
// getAllDrafts/clearAllDrafts): REST-часть в воркере; пустой текст на save
// удаляет черновик на бэке (draftMessageEmpty).
import type { RestClient } from '../net/restClient'
import { mapDraft, mapDraftMessage, type Draft, type DraftMessage, type MessageEntity, type RawDraft } from '../models'

export function newDraftsManager({ rest }: { rest: RestClient }) {
  return {
    async list(): Promise<Draft[]> {
      // Витрина отвечает теми же кадрами, что приезжают живыми
      // (`messages.getAllDrafts` у оригинала — контейнер `Updates`), поэтому
      // разбор один и тот же. Пустых конструкторов в списке не бывает — снятый
      // черновик просто не хранится, — но тип обязывает их отсеять.
      const r = await rest.get<{ drafts: RawDraft[] }>('/drafts')
      return (r.drafts ?? []).map(mapDraft).filter((d): d is Draft => d !== null)
    },

    async save(peerId: number, text: string, replyToId?: number | null, entities?: MessageEntity[]): Promise<Draft | null> {
      const r = await rest.put<{ draft: DraftMessage }>(`/chats/${peerId}/draft`, {
        text, entities: entities ?? null, reply_to_id: replyToId ?? null,
      })
      // «Снят» приезжает КОНСТРУКТОРОМ draftMessageEmpty, а не null.
      return mapDraftMessage(peerId, r.draft)
    },

    async delete(peerId: number): Promise<void> {
      await rest.del(`/chats/${peerId}/draft`)
    },

    async clearAll(): Promise<void> {
      await rest.del('/drafts')
    },
  }
}
