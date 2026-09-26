import type { RestClient } from '../net/restClient'
import type { UserReal } from '../peers/peer'
import type { AppState } from '../state/state'
import type { PeersManager } from './peersManager'
import SearchIndex from '@lib/searchIndex'
import cleanSearchText from '@helpers/cleanSearchText'
import { getUserSearchText } from '../peers/peerSearchText'

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

/** Порт `SEARCH_OPTIONS` (tweb `appUsersManager.ts:35-40`). */
const SEARCH_OPTIONS = {
  clearBadChars: true,
  ignoreCase: true,
  latinize: true,
  includeTag: true,
}

/** Порт лимита `recentSearch` (tweb `appUsersManager.ts:283-285`). */
const RECENT_SEARCH_LIMIT = 20

export interface ContactsDeps {
  rest: RestClient
  /**
   * Хранилище карточек: книга сохраняет свои `users` (порт
   * `saveApiUsers(result.users)` в `fillContacts`, `appUsersManager.ts:320`),
   * а индекс и сортировка читают имена оттуда — своей копии карточек книга
   * не держит.
   */
  peers: Pick<PeersManager, 'saveApiPeers' | 'cachedPeer'>
  /** Текущий пользователь (`getSelf()` оригинала) — нужен `includeSaved`. */
  getMe: () => UserReal | null
  /**
   * State воркера — порт `appStateManager.getState()`/`pushToState()`.
   * `pushToState` — тот же writer, что `persistManager.stateKey`: диск +
   * зеркало ключа во все вкладки (`state:mirror`), второго писателя ключа не
   * заводим.
   */
  state: {
    getState: () => Promise<Partial<Pick<AppState, 'recentSearch'>>>
    pushToState: <K extends keyof AppState>(key: K, value: AppState[K]) => Promise<void>
  }
}

/**
 * Книга контактов и «недавние» глобального поиска — половина tweb
 * `appUsersManager`, отвечающая за контакты: `contactsList` + `contactsIndex`
 * (`appUsersManager.ts:52,253,387-396`), `fillContacts` (:307-345),
 * `getContacts`/`getContactsPeerIds` (:417-481), `testSelfSearch` (:501-506),
 * `pushRecentSearch`/`clearRecentSearch` (:277-305).
 *
 * Расхождения с оригиналом:
 *  1. `recentSearch` хранит ключ пира СТРОКОЙ (`core/state/state.ts:22`,
 *     разница модели), поэтому `pushRecentSearch` принимает `PeerId`, а пишет
 *     `'' + peerId`.
 *  2. `peersStorage.requestPeer/releasePeer(peerId, 'recentSearch')` не
 *     перенесены: удержания карточек от выселения у нас нет — хранилище
 *     карточек ничего не выселяет (докблок `peersManager.ts`).
 *  3. State у оригинала — один объект в памяти воркера, и конкурентные
 *     записи мутируют его по очереди; у нас State живёт на диске, поэтому
 *     записи «недавних» сериализованы очередью (`recentQueue`), иначе две
 *     одновременные прочитали бы один и тот же список и вторая затёрла бы
 *     первую.
 *  4. `getContacts` сортирует только по имени (`sortBy: 'name'`): ветки
 *     `'online'`/`'rating'` потребителей не имеют, а у `'rating'` нет ручки
 *     (`contacts.getTopPeers`, задача 14 плана глобального поиска).
 *  5. `fillContacts` — первым вызовом `list()` (наша ручка книги, её зовут и
 *     папки, и экран контакта): каждое чтение книги — тот же «свежий снимок»,
 *     что у оригинала `contacts.getContacts` в `fillContacts`, и он же
 *     перестраивает индекс. Контакт, появившийся/пропавший пушем карточки
 *     (`onContactUpdated` из `saveApiUser`, :655), индекс не двигает — у нас
 *     этого канала нет; двигают его `add`/`del` этой вкладки.
 */
export function newContactsManager({ rest, peers, getMe, state }: ContactsDeps) {
  const createSearchIndex = () => new SearchIndex<number>(SEARCH_OPTIONS)
  let contactsList = new Set<number>()
  let contactsIndex = createSearchIndex()
  /** Книга уже прочитана в этой сессии (`contactsFillPromise` оригинала). */
  let contactsFillPromise: Promise<unknown> | null = null
  /** Поколение сессии — тот же приём, что `sessionGen` у `dialogsManager`:
   *  ответ книги, отправленный под прошлым аккаунтом, не применяется. */
  let sessionGen = 0
  let recentQueue: Promise<unknown> = Promise.resolve()

  const userSearchText = (userId: number) => {
    const peer = peers.cachedPeer(userId)
    return getUserSearchText(peer?._ === 'user' ? peer : undefined)
  }

  function pushContact(userId: number): void {
    contactsList.add(userId)
    contactsIndex.indexObject(userId, userSearchText(userId))
  }

  function popContact(userId: number): void {
    contactsList.delete(userId)
    contactsIndex.indexObject(userId, '') // delete search index
  }

  /** Тело `fillContacts` (:318-331): свежий снимок книги заменяет список. */
  function applyContacts(r: ContactsContacts): void {
    contactsList.clear()
    peers.saveApiPeers({ users: r.users })
    for (const contact of r.contacts ?? []) pushContact(contact.user_id)
  }

  async function list(): Promise<Contact[]> {
    const gen = sessionGen
    const r = await rest.get<ContactsContacts>('/contacts')
    if (gen === sessionGen) {
      applyContacts(r)
      contactsFillPromise = Promise.resolve()
    }
    return mapContacts(r)
  }

  /** Порт `fillContacts` (:307-345): книга читается один раз, упавшее чтение
   *  не залипает — следующий вызов повторит. */
  function fillContacts(): Promise<unknown> {
    return contactsFillPromise ??= list().catch(() => { contactsFillPromise = null })
  }

  /** `sortName` оригинала (`appUsersManager.ts:593-597`) — у нас не хранится
   *  на карточке, а считается при сортировке. */
  function sortName(userId: number): string {
    const user = peers.cachedPeer(userId)
    if (user?._ !== 'user' || user.pFlags?.deleted) return ''
    return cleanSearchText(user.first_name + (user.last_name ? ' ' + user.last_name : ''), false)
  }

  /** Порт `testSelfSearch` (:501-506). */
  function testSelfSearch(query: string): boolean {
    const self = getMe()
    if (!self) return false
    const index = createSearchIndex()
    index.indexObject(self.id, getUserSearchText(self))
    return index.search(query).has(self.id)
  }

  /** Порт `getContacts` (:417-465) в объёме `sortBy: 'name'` (расхождение 4). */
  async function getContacts(query?: string, includeSaved = false): Promise<number[]> {
    await fillContacts()
    let contacts = [...contactsList]
    if (query) {
      const results = contactsIndex.search(query)
      contacts = contacts.filter((id) => results.has(id))
    }

    contacts.sort((userId1, userId2) => sortName(userId1).localeCompare(sortName(userId2)))

    const myUserId = getMe()?.id
    if (myUserId !== undefined) {
      const idx = contacts.indexOf(myUserId)
      if (idx !== -1) contacts.splice(idx, 1)
      if (includeSaved && testSelfSearch(query ?? '')) {
        contacts.unshift(myUserId)
      }
    }

    return contacts
  }

  return {
    /**
     * Порт `getContactsPeerIds` (:467-481) — локальный поиск по книге для
     * группы «Chats» глобального поиска и чипов пиров. Сеть — только первое
     * чтение книги за сессию.
     *
     * `sortBy` оставлен позиционным ради формы вызова оригинала
     * (`getContactsPeerIds(query, true, undefined, 10)`), но значение у него
     * одно — расхождение 4.
     */
    async getContactsPeerIds(query?: string, includeSaved?: boolean, _sortBy?: 'name', limit?: number): Promise<PeerId[]> {
      const peerIds: PeerId[] = await getContacts(query, includeSaved)
      if (limit) {
        return peerIds.slice(0, limit)
      }

      return peerIds
    },

    /** Порт `pushRecentSearch` (:277-293): пир — первым, повтор не дублирует,
     *  список не длиннее 20. Запись — через State: диск + зеркало во вкладки. */
    pushRecentSearch(peerId: PeerId): Promise<void> {
      const key = '' + peerId
      const run = recentQueue.then(async () => {
        const recentSearch = [...((await state.getState()).recentSearch ?? [])]
        if (recentSearch[0] !== key) {
          const idx = recentSearch.indexOf(key)
          if (idx !== -1) recentSearch.splice(idx, 1)
          recentSearch.unshift(key)
          if (recentSearch.length > RECENT_SEARCH_LIMIT) {
            recentSearch.length = RECENT_SEARCH_LIMIT
          }

          await state.pushToState('recentSearch', recentSearch)
        }
      })
      recentQueue = run.catch(() => {})
      return run
    },

    /** Порт `clearRecentSearch` (:295-305). */
    clearRecentSearch(): Promise<void> {
      const run = recentQueue.then(() => state.pushToState('recentSearch', []))
      recentQueue = run.catch(() => {})
      return run
    },

    /**
     * Сброс книги на логауте/смене аккаунта — рядом с `dialogs.resetForLogout()`
     * (workerCore.ts): менеджер живёт в SharedWorker, переживающем вкладку, и
     * без сброса следующий аккаунт искал бы по чужой книге. У tweb то же
     * делает `clear()` менеджера (`appUsersManager.ts:253-256`).
     */
    resetForLogout(): void {
      sessionGen++
      contactsList = new Set()
      contactsIndex = createSearchIndex()
      contactsFillPromise = null
    },

    // Ответ добавления — тот же контейнер книги с одной строкой: у оригинала
    // добавление отвечает тем же, чем чтение. Добавленный — в книгу и индекс
    // (`onContactUpdated` → `pushContact`, :1098-1110).
    async add(input: AddContactInput): Promise<Contact> {
      const r = await rest.post<ContactsContacts>('/contacts', {
        contact_id: input.contactId ?? 0,
        phone: input.phone ?? '',
        first_name: input.firstName,
        last_name: input.lastName ?? '',
        note: input.note ?? '',
        share_phone: input.sharePhone ?? false,
      })
      peers.saveApiPeers({ users: r.users })
      for (const contact of r.contacts ?? []) pushContact(contact.user_id)
      return mapContacts(r)[0]
    },

    list,

    // Удалённый — из книги и индекса (`onContactUpdated` → `popContact`).
    async del(contactId: number): Promise<void> {
      await rest.del(`/contacts/${contactId}`)
      popContact(contactId)
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
