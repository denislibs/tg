import type { RestClient } from '../net/restClient'

// One address-book entry as the UI uses it (camelCase). The saved name is the
// owner's name for this contact; the profile fields (username/avatar/phone) are
// the peer's own, joined by the backend for display.
export interface Contact {
  userId: number
  firstName: string
  lastName: string
  note: string
  sharePhone: boolean
  username?: string
  avatarUrl: string
  phone: string
  displayName: string
  /** у владельца задано личное фото этого контакта (avatarUrl уже подменён им) */
  hasCustomPhoto: boolean
  createdAt: string
}

interface RawContact {
  user_id: number
  first_name: string
  last_name: string
  note: string
  share_phone: boolean
  username?: string | null
  avatar_url: string
  phone: string
  display_name: string
  has_custom_photo?: boolean
  created_at: string
}

const mapContact = (c: RawContact): Contact => ({
  userId: c.user_id,
  firstName: c.first_name,
  lastName: c.last_name,
  note: c.note,
  sharePhone: c.share_phone,
  username: c.username ?? undefined,
  avatarUrl: c.avatar_url,
  phone: c.phone,
  displayName: c.display_name,
  hasCustomPhoto: !!c.has_custom_photo,
  createdAt: c.created_at,
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
    // это фото вместо настоящего аватара контакта. Возвращает url для оптимистичного
    // обновления сторов.
    async setPhoto(contactId: number, mediaId: number): Promise<{ url: string }> {
      return rest.put<{ url: string }>(`/contacts/${contactId}/photo`, { media_id: mediaId })
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
