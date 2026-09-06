// Разбор хэша навигации: ссылка на сообщение обязана И открыть чат, И поставить
// прыжок. Без прыжка ссылка «Copy Message Link» открывала бы просто чат — то
// есть молча теряла бы половину смысла, и никакой тест это бы не поймал.
//
// ── ПОЧЕМУ ЗДЕСЬ НАСТОЯЩИЕ МЕНЕДЖЕРЫ ────────────────────────────────────────
// Ветка `@username` — это ровно то место, где «зелёный тест на сломанном коде»
// и появляется: подставь сюда `{ peers: { resolveUsername: async () => peer } }`
// — и пин станет проверять СВОЙ объект, а не порт `appUsersManager.resolveUsername`
// (tweb `appUsersManager.ts:344-359`), у которого весь смысл в кэше имён и в
// ЧИСЛЕ запросов. Поэтому подменяется единственная настоящая граница — HTTP
// (`RestClient`), а `peers`/`dialogs`/`channels` собираются НАСТОЯЩИМИ
// фабриками воркера. Все утверждения про «сколько запросов» считаются по
// вызовам этой границы.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyHash } from './useUrlSync'
import { useNavigationStore } from '@stores/navigationStore'
import { useChatsStore } from '@stores/chatsStore'
import { useSearchStore } from '@stores/searchStore'
import { useI18nStore } from '@/i18n'
import { applyLang } from '@/test/lang'
import type { Managers } from '../../client/bootstrap'
import type { RestClient } from '@core/net/restClient'
import { HttpError } from '@core/net/restClient'
import { newPeersManager } from '@core/managers/peersManager'
import { newDialogsManager } from '@core/managers/dialogsManager'
import { newChannelsManager } from '@core/managers/channelsManager'
import { resetPeerMirror } from '../peerCache'
import { makeDialog } from '../dialogs/testDialog'
import type { Chat, UserReal } from '../peers/peer'
import type { Dialog } from '../models'

const durov: Chat = {
  _: 'channel', id: 42, title: 'Дуров', username: 'durov',
  photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true },
}
const someone: UserReal = {
  _: 'user', id: 7, first_name: 'Петя', username: 'petya', photo: { _: 'userProfilePhotoEmpty' },
}

/** Единственная подмена — сеть. Директория `/search` отдаёт ровно то, что в ней
 *  «лежит»; всё остальное собирается настоящими фабриками воркера. */
function stand({ directory = { chats: [] as Chat[], users: [] as UserReal[] }, dialogs = [] as Dialog[] } = {}) {
  const gets: string[] = []
  const posts: { path: string; body: unknown }[] = []
  const rest = {
    async get<R>(path: string, query?: Record<string, string | number>): Promise<R> {
      gets.push(path)
      if (path === '/search') {
        const q = String(query?.q ?? '').toLowerCase()
        return {
          _: 'contacts.found',
          chats: directory.chats.filter((c) => 'username' in c && c.username?.toLowerCase().startsWith(q)),
          users: directory.users.filter((u) => u.username?.toLowerCase().startsWith(q)),
        } as unknown as R
      }
      // Список диалогов (`refresh`) — контейнер без строк: этому файлу важно
      // только, ходили за ним или нет.
      if (path === '/chats') return { _: 'messages.dialogs', dialogs: [], messages: [], chats: [], users: [] } as unknown as R
      throw new HttpError(404, `unexpected GET ${path}`)
    },
    async post<R>(path: string, body: unknown): Promise<R> {
      posts.push({ path, body })
      return { _: 'boolTrue' } as unknown as R
    },
  } as unknown as RestClient

  const peers = newPeersManager({ rest })
  const dialogsMgr = newDialogsManager({
    rest: rest as never,
    onDialogOps: () => {},
    loadCache: async () => dialogs,
    loadState: async () => ({ pinnedOrders: {} }),
    peers,
  })
  const channels = newChannelsManager({ rest, beforeSending: () => {}, peers, cacheViews: () => {} })

  return {
    gets, posts, peers,
    managers: { peers, dialogs: dialogsMgr, channels } as unknown as Managers,
  }
}

const toastText = () => document.querySelector('.toast')?.textContent ?? null

beforeEach(async () => {
  useI18nStore.setState({ lang: 'ru' })
  await applyLang('ru')
  resetPeerMirror()
  useNavigationStore.getState().selectChat(null)
  useSearchStore.getState().clearPendingJump()
  useChatsStore.setState({ dialogs: [] })
  // Всплывашка — синглтон-узел модуля (`components/toast.ts`), между тестами
  // его надо ОТЦЕПИТЬ, а не прятать: `toast()` возвращает узел в контейнер
  // только когда у него нет родителя.
  document.querySelector('.toast')?.remove()
})

afterEach(() => { vi.useRealTimers() })

describe('applyHash', () => {
  it('#<peerId>/<seq> — открывает чат и ставит прыжок к сообщению', async () => {
    await applyHash('#42/7', stand().managers)

    expect(useNavigationStore.getState().selectedId).toBe('42')
    expect(useSearchStore.getState().pendingJump).toEqual({ peerId: 42, seq: 7 })
  })

  // Порт `appUsersManager.resolveUsername` (tweb :344-359): попадание в индекс
  // имён СЕТИ НЕ СТОИТ. Карточка кладётся в кэш ровно так, как она туда
  // попадает в проде, — попутным вектором `chats` любого ответа
  // (`saveApiPeers`), а не «подставленным резолвом».
  it('#@username/<seq> — известное имя открывается БЕЗ единого запроса', async () => {
    const s = stand({ dialogs: [makeDialog({ peerId: -42 })] })
    s.peers.saveApiPeers({ chats: [durov] })

    await applyHash('#@durov/9', s.managers)

    expect(useNavigationStore.getState().selectedId).toBe('-42')
    expect(useSearchStore.getState().pendingJump).toEqual({ peerId: -42, seq: 9 })
    expect(s.gets).toEqual([])
    expect(s.posts).toEqual([])
  })

  // Главный пин задачи: открытие по ссылке БОЛЬШЕ НЕ ЗАВИСИТ от витрины
  // диалогов. Прежний код резолвил имя сканом `useChatsStore.dialogs`
  // (+ `cachedChat`), поэтому до загрузки списка чатов ссылка не открывалась
  // вовсе — а в оригинале `onHashChange` стоит ДО чатлиста
  // (tweb `appImManager.ts:834` против `appDialogsManager.ts:726`).
  it('витрина диалогов пуста — ссылка всё равно открывает чат', async () => {
    const s = stand({ dialogs: [makeDialog({ peerId: -42 })] })
    s.peers.saveApiPeers({ chats: [durov] })
    expect(useChatsStore.getState().dialogs).toEqual([])

    await applyHash('#@durov', s.managers)

    expect(useNavigationStore.getState().selectedId).toBe('-42')
  })

  // Промах индекса — ОДИН запрос (tweb: один `contacts.resolveUsername`), а не
  // прежняя тройка «search → join → refresh». Вступление здесь есть только
  // потому, что строки диалога нет: наш бэкенд не-участнику историю не отдаёт
  // (см. докблок ветки в `useUrlSync.ts`).
  it('незнакомое имя — один запрос к директории; в свой канал не вступает повторно', async () => {
    const known = stand({ directory: { chats: [durov], users: [] }, dialogs: [makeDialog({ peerId: -42 })] })
    await applyHash('#@durov', known.managers)

    expect(known.gets).toEqual(['/search'])
    expect(known.posts).toEqual([])
    expect(useNavigationStore.getState().selectedId).toBe('-42')
  })

  it('канала нет в диалогах — вступаем и открываем', async () => {
    const s = stand({ directory: { chats: [durov], users: [] } })

    await applyHash('#@durov', s.managers)

    expect(s.posts.map((p) => p.path)).toEqual(['/channels/join'])
    expect(useNavigationStore.getState().selectedId).toBe('-42')
  })

  // Директория ищет ПРЕФИКСОМ (`searchrepo.go`, `ILIKE 'q%'`) — совпадение
  // обязано сверяться точно, иначе `#@dur` открывал бы `@durov`.
  it('префиксное совпадение чужим именем не считается', async () => {
    const s = stand({ directory: { chats: [durov], users: [] } })

    await applyHash('#@dur', s.managers)

    expect(useNavigationStore.getState().selectedId).toBeNull()
    expect(toastText()).toBe('Аккаунта с таким именем пользователя не существует.')
  })

  // Порт `openUsername` (tweb `appImManager.ts:1801-1809`): отказ ВИДЕН.
  // Раньше здесь стоял пустой `catch {}` — пользователь оставался на списке
  // чатов без единого слова, и это единственный путь, на котором «шапка есть,
  // ленты нет» становилось постоянным.
  it('имя не занято — пользователь видит отказ, а не пустой экран', async () => {
    const s = stand()

    await applyHash('#@nobody', s.managers)

    expect(toastText()).toBe('Аккаунта с таким именем пользователя не существует.')
    expect(useNavigationStore.getState().selectedId).toBeNull()
  })

  // Отказ СЕТИ — не «имени нет»: третья ветка тоста (см. её докблок в
  // `useUrlSync.ts`). Под оригиналом эту роль исполняет индикатор соединения
  // транспорта, под нашим REST — никто.
  it('директория недоступна — отказ тоже виден, и текст другой', async () => {
    const failing = {
      async get(): Promise<never> { throw new HttpError(500, 'boom') },
      async post(): Promise<never> { throw new HttpError(500, 'boom') },
    } as unknown as RestClient
    const peers = newPeersManager({ rest: failing })

    await applyHash('#@durov', { peers } as unknown as Managers)

    expect(toastText()).toBe('Что-то пошло не так')
    expect(useNavigationStore.getState().selectedId).toBeNull()
  })

  // Ветка `USERNAME_INVALID` оригинала (tweb :1806-1808) — своя, отдельная
  // подпись: «имя пустое» это не «имя свободно».
  it('пустое имя — своя подпись отказа', async () => {
    const s = stand()

    await applyHash('#@ ', s.managers)

    expect(toastText()).toBe('Извините, такого пользователя не существует.')
    expect(s.gets).toEqual([])
  })

  it('#@username человека — открывается черновик, а не чат', async () => {
    const s = stand({ directory: { chats: [], users: [someone] } })

    await applyHash('#@petya', s.managers)

    expect(useNavigationStore.getState().selectedId).toBe('draft:7')
    expect(useNavigationStore.getState().draftPeer?.id).toBe(7)
  })

  it('#<peerId> без якоря — чат открывается, прыжка нет', async () => {
    await applyHash('#42', stand().managers)

    expect(useNavigationStore.getState().selectedId).toBe('42')
    expect(useSearchStore.getState().pendingJump).toBeNull()
  })

  it('пустой хэш — возврат к списку чатов', async () => {
    useNavigationStore.getState().selectChat('42')

    await applyHash('', stand().managers)

    expect(useNavigationStore.getState().selectedId).toBeNull()
  })

  it('нераспознанный хэш навигацию не трогает', async () => {
    useNavigationStore.getState().selectChat('42')

    await applyHash('#не-хэш', stand().managers)

    expect(useNavigationStore.getState().selectedId).toBe('42')
    expect(useSearchStore.getState().pendingJump).toBeNull()
  })
})
