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

/**
 * `contacts.contacts` — адресная книга контейнером.
 *
 * СТРОКА книги это ССЫЛКА (`contact{user_id, mutual}`), а карточки едут
 * вектором `users`: прежде карточка была вклеена в каждую строку рядом со
 * ссылкой — тот же снимок-вместо-ссылки, что убирался у диалогов.
 *
 * Наших полей строки (`note`, `share_phone`, `has_custom_photo`, `created_at`)
 * у конструктора нет: у оригинала заметок к контакту не бывает вовсе, а
 * номером делятся правилом приватности. Экраны, которым они нужны, названы
 * задачей.
 */
export interface ContactsContacts {
  _: 'contacts.contacts'
  contacts: { _: 'contact'; user_id: number; mutual: { _: 'boolTrue' | 'boolFalse' } }[]
  saved_count: number
  users: UserReal[]
}

const mapContacts = (r: ContactsContacts): Contact[] => {
  const byId = new Map((r.users ?? []).map((u) => [u.id, u]))
  return (r.contacts ?? []).flatMap((c) => {
    const user = byId.get(c.user_id)
    return user ? [{ userId: c.user_id, note: '', sharePhone: false, hasCustomPhoto: false, createdAt: '', user }] : []
  })
}

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
    // Ответ добавления — тот же контейнер книги с одной строкой: у оригинала
    // добавление отвечает тем же, чем чтение.
    async add(input: AddContactInput): Promise<Contact> {
      const r = await rest.post<ContactsContacts>('/contacts', {
        contact_id: input.contactId ?? 0,
        phone: input.phone ?? '',
        first_name: input.firstName,
        last_name: input.lastName ?? '',
        note: input.note ?? '',
        share_phone: input.sharePhone ?? false,
      })
      return mapContacts(r)[0]
    },

    async list(): Promise<Contact[]> {
      return mapContacts(await rest.get<ContactsContacts>('/contacts'))
    },

    async del(contactId: number): Promise<void> {
      await rest.del(`/contacts/${contactId}`)
    },

    // Личное фото контакта (Telegram personal_photo, save=true): владелец видит
    // это фото вместо настоящего аватара контакта.
    //
    // Номер фото в ответе больше не едет: он был ЭХОМ запроса — тем же
    // `mediaId`, который клиент только что прислал, — и оптимистичное
    // обновление сторов делается из своего же аргумента.
    async setPhoto(contactId: number, mediaId: number): Promise<void> {
      await rest.put(`/contacts/${contactId}/photo`, { media_id: mediaId })
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
