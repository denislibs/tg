// Облачные черновики (tweb appDraftsManager поверх messages.saveDraft/
// getAllDrafts/clearAllDrafts): REST-часть в воркере; пустой текст на save
// удаляет черновик на бэке (draftMessageEmpty).
import type { RestClient } from '../net/restClient'
import type { DraftMessage, MessageEntity, RawDraft } from '../models'

export function newDraftsManager({ rest }: { rest: RestClient }) {
  return {
    // Витрина отвечает теми же КАДРАМИ, что приезжают живыми, и КОНТЕЙНЕРОМ
    // `updates` — так у оригинала (`messages.getAllDrafts` объявлен
    // возвращающим `Updates`); применяет их тот же владелец: черновик это поле
    // диалога. Маппера нет — форма провода и форма модели совпали.
    async list(): Promise<RawDraft[]> {
      const r = await rest.get<{ _: 'updates'; updates: RawDraft[] }>('/drafts')
      return r.updates ?? []
    },

    // Сохранение отвечает ТЕМ ЖЕ кадром, что едет в списке и приезжает живым:
    // третьей формы одного черновика больше нет.
    async save(peerId: number, text: string, replyToId?: number | null, entities?: MessageEntity[]): Promise<DraftMessage> {
      const r = await rest.put<RawDraft>(`/chats/${peerId}/draft`, {
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
