import type { RestClient } from '../net/restClient'
import type { UserReal } from '../peers/peer'

// Запись адресной книги: НАША обвязка (заметка, «делиться номером», личное
// фото) плюс КОНСТРУКТОР `user` самого контакта. Прежде профиль контакта был
// рассыпан плоскими полями рядом (`first_name`, `display_name`, `avatar_url`,
// `avatar_preview`, `phone`) — вторым снимком того же пользователя, который
// уже приезжает с `/users`. Имя контакта собирает клиент из `user.first_name`/
// `user.last_name` (`core/peers/getPeerTitle.ts`), аватарка — `user.photo`.
export interface Contact {
  userId: number
  note: string
  sharePhone: boolean
  /** у владельца задано личное фото этого контакта (`user.photo` уже подменён им) */
  hasCustomPhoto: boolean
  createdAt: string
  user: UserReal
}

interface RawContact {
  user_id: number
  note: string
  share_phone: boolean
  has_custom_photo?: boolean
  created_at: string
  user: UserReal
}

const mapContact = (c: RawContact): Contact => ({
  userId: c.user_id,
  note: c.note,
  sharePhone: c.share_phone,
  hasCustomPhoto: !!c.has_custom_photo,
  createdAt: c.created_at,
  user: c.user,
})

export interface AddContactInput {
  /** id существующего пользователя (0/пусто → добавление по номеру) */
  contactId?: number
  /** номер телефона (используется, когда contactId не задан) — как tweb importContact */
  phone?: string
  firstName: string
  lastName?: string
  note?: string
  sharePhone?: boolean
}

export interface ContactsDeps {
  rest: RestClient
}

export function newContactsManager({ rest }: ContactsDeps) {
  return {
    async add(input: AddContactInput): Promise<Contact> {
      return mapContact(
        await rest.post<RawContact>('/contacts', {
          contact_id: input.contactId ?? 0,
          phone: input.phone ?? '',
          first_name: input.firstName,
          last_name: input.lastName ?? '',
          note: input.note ?? '',
          share_phone: input.sharePhone ?? false,
        }),
      )
    },

    async list(): Promise<Contact[]> {
      const r = await rest.get<{ contacts: RawContact[] }>('/contacts')
      return r.contacts.map(mapContact)
    },

    async del(contactId: number): Promise<void> {
      await rest.del(`/contacts/${contactId}`)
    },

    // Личное фото контакта (Telegram personal_photo, save=true): владелец видит
    // это фото вместо настоящего аватара контакта. Возвращает id медиа для
    // оптимистичного обновления сторов — не строку `/media/N/content`, из
    // которой это же число потом выпарсивали регуляркой.
    async setPhoto(contactId: number, mediaId: number): Promise<{ photoId: number }> {
      const r = await rest.put<{ photo_id: number }>(`/contacts/${contactId}/photo`, { media_id: mediaId })
      return { photoId: r.photo_id }
    },

    // Сброс личного фото — снова показывается настоящий аватар контакта.
    async clearPhoto(contactId: number): Promise<void> {
      await rest.del(`/contacts/${contactId}/photo`)
    },

    // Предложить контакту новое фото профиля (Telegram suggest=true): создаёт
    // сервисное сообщение с превью и кнопкой «Установить фото» у получателя.
    async suggestPhoto(contactId: number, mediaId: number): Promise<void> {
      await rest.post(`/contacts/${contactId}/suggest_photo`, { media_id: mediaId })
    },

    // Принять предложенное фото профиля: оно становится аватаром принявшего.
    async acceptPhotoSuggestion(msgId: number): Promise<void> {
      await rest.post(`/photo_suggestions/${msgId}/accept`, {})
    },
  }
}

export type ContactsManager = ReturnType<typeof newContactsManager>
