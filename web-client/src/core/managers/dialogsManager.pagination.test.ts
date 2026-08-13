// Этап 2 (пагинация диалогов), Task 6: `getDialogs({offsetIndex, limit, filterId})`
// — порт tweb `dialogsStorage.getDialogs` (lib/storages/dialogs.ts:1691-1753).
// Владелец отдаёт страницу ИЗ СВОЕГО КЭША и идёт в сеть только когда кэша не
// хватает; курсор — ЗНАЧЕНИЕ индекса (`offsetIndex`), а не позиция, поэтому
// список может переехать между запросами.
//
// Стенд — тот же, что в dialogsManager.test.ts (фабрика менеджера + фейковый
// rest), свой сетап не изобретаем.
import { describe, expect, it, vi } from 'vitest'
import { newDialogsManager } from './dialogsManager'
import { ARCHIVE_FOLDER_ID } from '../folderIds'
import { mapDialog } from '../models'
import type { Dialog, Draft, RawDialog } from '../models'
import type { DialogOp } from '../dialogs/dialogOps'
import type { Folder } from './foldersManager'

const at = (day: number) => `2026-08-${String(day).padStart(2, '0')}T00:00:00Z`

const dialog = (chatId: number, day: number, over: Partial<Dialog> = {}): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 1, at: at(day) },
  ...over,
} as Dialog)

const raw = (chatId: number, day: number, over: Record<string, unknown> = {}): RawDialog => ({
  chat_id: chatId, type: 'private', title: 't' + chatId, unread: 0, last_read_seq: 0,
  last_message: { seq: 1, text: 'x', sender_id: 1, at: at(day) },
  ...over,
} as unknown as RawDialog)

const folder = (over: Partial<Folder>): Folder => ({
  id: 7, title: 'F', pos: 0,
  includeChats: [], excludeChats: [],
  contacts: false, nonContacts: false, groups: false, broadcasts: false,
  excludeRead: false, excludeMuted: false,
  ...over,
})

/** Ответ `/chats` в форме Task 3: `{chats, count, is_end}`. */
type ChatsResponse = { chats: RawDialog[]; count: number; is_end: boolean }
const restStub = (r: Partial<ChatsResponse> & { chats: RawDialog[] }) =>
  ({ get: vi.fn(async () => ({ count: r.chats.length, is_end: true, ...r })) })

/**
 * Кэш владельца, наполненный СЕТЬЮ целиком: `refresh()` получил `is_end` без
 * курсора → `loadedAll`. Именно в этом состоянии живёт список после обычной
 * загрузки (этап 2 внешнего поведения не меняет — UI по-прежнему просит всё).
 */
async function loadedAllManager(days: number[]) {
  const rest = restStub({ chats: days.map((d) => raw(d, d)), count: days.length, is_end: true })
  const ops: DialogOp[] = []
  const mgr = newDialogsManager({
    rest: rest as never,
    onDialogOps: (o) => ops.push(...o),
    loadCache: async () => [],
    loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
  })
  await mgr.refresh()
  rest.get.mockClear()
  ops.length = 0
  return { mgr, rest, ops }
}

describe('dialogsManager.getDialogs: страница из кэша (порт dialogs.ts:1691-1710)', () => {
  it('кэш загружен целиком — сеть НЕ дёргается, отдаётся первое окно', async () => {
    const { mgr, rest } = await loadedAllManager([1, 2, 3, 4, 5])

    const page = await mgr.getDialogs({ limit: 2 })

    expect(page.dialogs.map((d) => d.chatId)).toEqual([5, 4]) // свежие выше
    expect(page.count).toBe(5)
    expect(page.isEnd).toBe(false)
    expect(rest.get).not.toHaveBeenCalled()
  })

  it('offsetIndex двигает окно: курсор — индекс последнего полученного', async () => {
    const { mgr } = await loadedAllManager([1, 2, 3, 4, 5])
    const second = mgr.getSnapshot()[1].index // индекс диалога 4

    const page = await mgr.getDialogs({ offsetIndex: second, limit: 2 })

    expect(page.dialogs.map((d) => d.chatId)).toEqual([3, 2])
  })

  // `loadedAll` (порт tweb `isDialogsLoaded`) поднимает именно `refresh()`:
  // запрос без параметров, ответ с `is_end` — кэш покрыл набор целиком. Без
  // флага окно ШИРЕ кэша выглядело бы как нехватка и гнало бы в сеть на каждый
  // запрос конца списка.
  it('после refresh(), покрывшего весь набор, окно шире кэша отвечает из памяти', async () => {
    const { mgr, rest } = await loadedAllManager([1, 2])

    const page = await mgr.getDialogs({ limit: 5 })

    expect(rest.get).not.toHaveBeenCalled()
    expect(page.dialogs.map((d) => d.chatId)).toEqual([2, 1])
    expect(page.isEnd).toBe(true)
  })

  it('offsetIndex последнего элемента — пустая страница с isEnd', async () => {
    const { mgr } = await loadedAllManager([1, 2, 3, 4, 5])
    const snapshot = mgr.getSnapshot()
    const last = snapshot[snapshot.length - 1].index

    const page = await mgr.getDialogs({ offsetIndex: last, limit: 2 })

    expect(page.dialogs).toEqual([])
    expect(page.isEnd).toBe(true)
  })
})

describe('dialogsManager.getDialogs: догрузка страницы (порт dialogs.ts:1712-1752)', () => {
  it('кэша не хватает — РОВНО один запрос с limit/offset_chat_id, ответ слит и отдан', async () => {
    const rest = restStub({ chats: [raw(3, 3), raw(4, 4)], count: 4, is_end: false })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      // офлайн-кэш прошлой сессии: два диалога, сеть их не покрывала (loadedAll=false)
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    const page = await mgr.getDialogs({ limit: 4 })

    expect(rest.get).toHaveBeenCalledTimes(1)
    // Курсор к серверу — chatId последнего элемента кэша (отступление №1 спеки:
    // у бэкенда нет понятия dialogIndex).
    expect(rest.get).toHaveBeenCalledWith('/chats', { limit: 4, offset_chat_id: 1 })
    expect(page.dialogs.map((d) => d.chatId)).toEqual([4, 3, 2, 1])
    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([4, 3, 2, 1])
  })

  it('слияние страницы публикует upsert, а не reset', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub({ chats: [raw(3, 3)], count: 3, is_end: false }) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    await mgr.fillMirror()
    ops.length = 0

    await mgr.getDialogs({ limit: 3 })

    expect(ops.map((o) => o.op)).toEqual(['upsert'])
    const op = ops[0] as Extract<DialogOp, { op: 'upsert' }>
    expect(op.items.map((i) => i.dialog.chatId)).toEqual([3])
  })

  it('повторная страница с теми же чатами не плодит дублей в кэше', async () => {
    const rest = restStub({ chats: [raw(1, 1), raw(2, 2)], count: 5, is_end: false })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.getDialogs({ limit: 5 })
    await mgr.getDialogs({ limit: 5 })

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([2, 1])
  })

  // Тот же инвариант, что у `refresh()` (Important #4, dialogsManager.test.ts):
  // совпавший с памятью ответ не даёт ни перерисовки, ни записи в IDB.
  it('страница с теми же значениями не публикует операцию и не планирует запись на диск', async () => {
    vi.useFakeTimers()
    const ops: DialogOp[] = []
    const save = vi.fn(async () => {})
    const mgr = newDialogsManager({
      rest: restStub({ chats: [raw(1, 1), raw(2, 2)], count: 9, is_end: false }) as never,
      onDialogOps: (o) => ops.push(...o),
      // офлайн-кэш — РОВНО то же, что принесёт страница
      loadCache: async () => [raw(1, 1), raw(2, 2)].map((r) => mapDialog(r)),
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
      saveCache: save,
    })
    await mgr.fillMirror()
    const before = mgr.getSnapshot()
    ops.length = 0

    await mgr.getDialogs({ limit: 5 })

    expect(ops).toEqual([])
    expect(mgr.getSnapshot()).toBe(before) // тот же массив по ССЫЛКЕ
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('count берётся из ответа сервера, пока список не загружен целиком; после — длина кэша', async () => {
    const rest = restStub({ chats: [raw(3, 3)], count: 137, is_end: false })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    const page = await mgr.getDialogs({ limit: 3 })
    expect(page.count).toBe(137) // серверный размер набора, а не длина кэша (3)

    const { mgr: full } = await loadedAllManager([1, 2, 3])
    expect((await full.getDialogs({ limit: 2 })).count).toBe(3)
  })

  // Ревью Important 5: tweb поднимает `dialogsLoaded` на ЛЮБОЙ дошедшей до
  // конца странице (appMessagesManager.ts:3639) — страницы там идут строго
  // сверху. У нас курсор — `chatId`, и при исчезнувшем опорном чате бэкенд
  // отдаёт с начала, поэтому одного `is_end` мало: сверяем кэш с размером
  // набора — ровно как tweb в `dialogsLength >= count`. Без этого КАЖДОЕ
  // касание хвоста списка навсегда стоило бы сетевого раунд-трипа.
  it('страница по курсору, закрывшая набор (кэш дорос до count), объявляет весь список загруженным', async () => {
    const rest = restStub({ chats: [raw(3, 3)], count: 3, is_end: true })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    expect((await mgr.getDialogs({ limit: 3 })).isEnd).toBe(true)
    rest.get.mockClear()

    // Кэш (3) дорос до серверного count (3) — дальше страницы из памяти.
    const page = await mgr.getDialogs({ limit: 10 })
    expect(rest.get).not.toHaveBeenCalled()
    expect(page.dialogs.map((d) => d.chatId)).toEqual([3, 2, 1])
    expect(page.count).toBe(3)
  })

  it('страница по курсору с is_end, но кэш меньше серверного count — загруженным набор НЕ считается', async () => {
    // `is_end` после курсора при count=9: «после опорного чата пусто», но
    // держим мы только 3 из 9 — начало набора нам неизвестно.
    const rest = restStub({ chats: [raw(3, 3)], count: 9, is_end: true })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.getDialogs({ limit: 3 })
    rest.get.mockClear()

    const page = await mgr.getDialogs({ limit: 10 })
    expect(rest.get).toHaveBeenCalledTimes(1) // окно шире кэша — снова в сеть
    expect(page.count).toBe(9) // и count по-прежнему серверный
  })

  // Порт `isEnd: result.isEnd && curDialogStorage[len-1] === dialogs[len-1]`
  // (dialogs.ts:1751): страница КОРОЧЕ хвоста кэша концом списка не является,
  // даже если сервер объявил `is_end` — ниже неё в кэше ещё есть диалоги.
  it('страница, не дотянувшаяся до хвоста кэша, концом набора не считается', async () => {
    const mgr = newDialogsManager({
      // ответ приносит троих разом — окно (3) закончится раньше хвоста (5)
      rest: restStub({ chats: [raw(5, 5), raw(4, 4), raw(3, 3)], count: 9, is_end: true }) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    const page = await mgr.getDialogs({ limit: 3 })

    expect(page.dialogs.map((d) => d.chatId)).toEqual([5, 4, 3]) // хвост кэша — 2 и 1
    expect(page.isEnd).toBe(false)
  })

  // Ревью Important 4 (настоящий баг): опорный чат курсора исчез с сервера →
  // `dialogpage.go:14-22` отдаёт страницу С НАЧАЛА → она не приносит ничего
  // нового → хвост кэша не двигается → следующий запрос уходит с ТЕМ ЖЕ
  // `offset_chat_id`. Без фолбэка список не продвинулся бы НИКОГДА.
  it('страница, не принёсшая ни одного нового диалога, лечится полным refresh(), а не залипает', async () => {
    const calls: (Record<string, number> | undefined)[] = []
    const rest = {
      get: vi.fn(async (_path: string, q?: Record<string, number>) => {
        calls.push(q)
        // страница по курсору — повтор уже известного (курсор не найден на сервере)
        if (q) return { chats: [raw(2, 2), raw(1, 1)], count: 9, is_end: false }
        // полный список (фолбэк) — весь набор
        return { chats: [raw(3, 3), raw(2, 2), raw(1, 1)], count: 3, is_end: true }
      }),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    const page = await mgr.getDialogs({ limit: 3 })

    expect(calls).toEqual([{ limit: 3, offset_chat_id: 1 }, undefined]) // страница, затем refresh()
    expect(page.dialogs.map((d) => d.chatId)).toEqual([3, 2, 1]) // список продвинулся
    expect(page.isEnd).toBe(true)
  })

  // Порт `count: loadedAll ? curDialogStorage.length : folder.count`
  // (dialogs.ts:1706): как только набор загружен целиком, размером служит
  // ДЛИНА КЭША, а серверный `count` прошлых страниц — устаревшее число.
  it('после полной загрузки count — длина кэша, а не серверный count прошлой страницы', async () => {
    const rest = {
      get: vi.fn(async (_path: string, q?: Record<string, number>) => (q
        ? { chats: [raw(3, 3)], count: 137, is_end: false } // страница: сервер знает про 137
        : { chats: [raw(1, 1), raw(2, 2), raw(3, 3)], count: 3, is_end: true })), // полный список
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    await mgr.getDialogs({ limit: 3 }) // страница запомнила serverCount = 137

    await mgr.refresh() // полный список: набор загружен целиком

    expect((await mgr.getDialogs({ limit: 2 })).count).toBe(3)
  })

  it('офлайн (сеть упала) — отдаём то, что есть в кэше, без исключения', async () => {
    const mgr = newDialogsManager({
      rest: { get: vi.fn(async () => { throw new Error('offline') }) } as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    const page = await mgr.getDialogs({ limit: 5 })

    expect(page.dialogs.map((d) => d.chatId)).toEqual([2, 1])
    expect(page.isEnd).toBe(false)
  })
})

// Фильтр папки применяется ЛОКАЛЬНО, в воркере (спека, «Фильтр папки переезжает
// в воркер»): определения приезжают State-ключом `folders`, контакты —
// `setContactIds`.
describe('dialogsManager.getDialogs: фильтр папки', () => {
  const contactDialog = dialog(1, 1, { peer: { id: 7, displayName: 'c', avatarUrl: '' } })
  const strangerDialog = dialog(2, 2, { peer: { id: 9, displayName: 's', avatarUrl: '' } })

  const withFolders = (folders: Folder[]) => newDialogsManager({
    rest: restStub({ chats: [] }) as never,
    onDialogOps: () => {},
    loadCache: async () => [contactDialog, strangerDialog, dialog(3, 3, { archived: true })],
    loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders }),
  })

  it('в страницу папки попадают только прошедшие matchesFolder', async () => {
    const mgr = withFolders([folder({ id: 7, contacts: true })])
    mgr.setContactIds([7])

    const page = await mgr.getDialogs({ filterId: 7, limit: 10 })

    expect(page.dialogs.map((d) => d.chatId)).toEqual([1])
  })

  // Ловушка: `Dialog` плоского `peerId` не имеет (там `peer.id`), а поле
  // `FolderMatchable.peerId` опционально — прямой вызов `matchesFolder(dialog,…)`
  // прошёл бы тайпчек молча и всегда считал приватный чат НЕ контактом. Адаптер
  // `dialogMatchesFolder` (core/folderFilter.ts) маппит `peer?.id`, как это уже
  // делает витрина (core/dialogToChat.ts:117).
  it('контактность приватного чата читается из peer.id (не из отсутствующего peerId)', async () => {
    const mgr = withFolders([folder({ id: 7, nonContacts: true })])
    mgr.setContactIds([7])

    const page = await mgr.getDialogs({ filterId: 7, limit: 10 })

    // Контакт (peer.id=7) в папку «Не контакты» попасть не должен — если
    // контактность считается по несуществующему `dialog.peerId`, сюда попадут ОБА.
    expect(page.dialogs.map((d) => d.chatId)).toEqual([2])
  })

  it('архив — своя псевдо-папка; «Все чаты» архивных не показывают', async () => {
    const mgr = withFolders([])

    expect((await mgr.getDialogs({ limit: 10 })).dialogs.map((d) => d.chatId)).toEqual([2, 1])
    expect((await mgr.getDialogs({ filterId: ARCHIVE_FOLDER_ID, limit: 10 })).dialogs.map((d) => d.chatId)).toEqual([3])
  })

  // Отступление от tweb (docblock ARCHIVE_FOLDER_ID, core/folderIds.ts): у них
  // архив — реальная папка с id 1 при пользовательских id от 2, у нас id папок
  // раздаёт Postgres С ЕДИНИЦЫ. Псевдо-id архива обязан лежать ВНЕ этого
  // пространства, иначе первая созданная пользователем папка молча стала бы
  // архивом.
  it('id архива не пересекается с id пользовательских папок', async () => {
    const mgr = withFolders([folder({ id: 1, nonContacts: true })])
    mgr.setContactIds([7])

    const page = await mgr.getDialogs({ filterId: 1, limit: 10 })

    expect(page.dialogs.map((d) => d.chatId)).toEqual([2]) // папка №1, а не архив ([3])
  })

  // Ревью Important 1: серверный `count` — размер ВСЕГО набора (бэкенд про
  // папки не знает), поэтому применим только к «Всем чатам». Для архива и
  // пользовательских папок размер — длина отфильтрованного кэша.
  it('count архива/папки — длина отфильтрованного кэша, а не глобальный серверный count', async () => {
    const mgr = newDialogsManager({
      rest: restStub({ chats: [raw(9, 9)], count: 137, is_end: false }) as never,
      onDialogOps: () => {},
      loadCache: async () => [contactDialog, strangerDialog, dialog(3, 3, { archived: true })],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [folder({ id: 7, nonContacts: true })] }),
    })
    mgr.setContactIds([7])
    await mgr.getDialogs({ limit: 5 }) // сеть отдала count всего набора (кэш стал 4)

    // Окна ниже умещаются в кэш — сеть больше не дёргается, сравниваем только count.
    expect((await mgr.getDialogs({ limit: 3 })).count).toBe(137) // «Все чаты» — серверный
    expect((await mgr.getDialogs({ filterId: ARCHIVE_FOLDER_ID, limit: 1 })).count).toBe(1)
    // В папку «не контакты» попали stranger (peer 9) и пришедший страницей
    // чат 9 (без peer, значит тоже не контакт) — двое, но НЕ 137.
    expect((await mgr.getDialogs({ filterId: 7, limit: 1 })).count).toBe(2)
  })

  // Ревью Important 3: tweb перед фильтрацией папки ЖДЁТ `fillContacts()`
  // (dialogs.ts:1625-1642). У нас контакты приезжают пушем, ждать нечего —
  // поэтому «контактов ещё не было» обязано вести себя как неизвестная папка:
  // пустая страница со скелетонами вместо МОЛЧА неверной (все — не-контакты).
  it('папка с правилом contacts/non_contacts до прихода контактов отдаёт пустую страницу, а не неверную', async () => {
    const rest = restStub({ chats: [] })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [contactDialog, strangerDialog],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [folder({ id: 7, nonContacts: true })] }),
    })

    // Контактов ещё не было: без гварда сюда попали БЫ оба чата (каждый
    // приватный без контактов считается не-контактом).
    expect(await mgr.getDialogs({ filterId: 7, limit: 10 })).toEqual({ dialogs: [], count: 0, isEnd: false })
    expect(rest.get).not.toHaveBeenCalled()

    mgr.setContactIds([7])

    expect((await mgr.getDialogs({ filterId: 7, limit: 10 })).dialogs.map((d) => d.chatId)).toEqual([2])
  })

  it('пустой список контактов — тоже знание: папка считается, а не ждёт вечно', async () => {
    const mgr = withFolders([folder({ id: 7, nonContacts: true })])
    mgr.setContactIds([])

    expect((await mgr.getDialogs({ filterId: 7, limit: 10 })).dialogs.map((d) => d.chatId)).toEqual([2, 1])
  })

  it('папка, чьи правила от контактов не зависят, считается и без них', async () => {
    const mgr = newDialogsManager({
      rest: restStub({ chats: [] }) as never,
      onDialogOps: () => {},
      loadCache: async () => [contactDialog, dialog(4, 4, { type: 'group' })],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [folder({ id: 7, groups: true })] }),
    })

    expect((await mgr.getDialogs({ filterId: 7, limit: 10 })).dialogs.map((d) => d.chatId)).toEqual([4])
  })

  it('неизвестная папка (определения ещё не приехали) — пустая страница, а не весь список; сеть не дёргается', async () => {
    const rest = restStub({ chats: [] })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [contactDialog, strangerDialog],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [] }),
    })

    const page = await mgr.getDialogs({ filterId: 42, limit: 10 })

    expect(page).toEqual({ dialogs: [], count: 0, isEnd: false })
    expect(rest.get).not.toHaveBeenCalled()
  })

  it('определения папок приезжают State-ключом folders (тем же каналом, что pinnedOrders/drafts)', async () => {
    const mgr = newDialogsManager({
      rest: restStub({ chats: [] }) as never,
      onDialogOps: () => {},
      loadCache: async () => [contactDialog, strangerDialog],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    await mgr.fillMirror()
    mgr.setContactIds([7])
    expect((await mgr.getDialogs({ filterId: 7, limit: 10 })).dialogs).toEqual([]) // папки ещё нет

    mgr.setStateKey('folders', [folder({ id: 7, nonContacts: true, contacts: true })])

    expect((await mgr.getDialogs({ filterId: 7, limit: 10 })).dialogs.map((d) => d.chatId)).toEqual([2, 1])
  })
})

// Хвост этапа 1 (спека, «Хвост из этапа 1: syncPinnedOrder»): порядок
// закреплённых выводится из ПОЛНОГО списка. Частичная страница его выводить не
// имеет права — иначе первая же страница зафиксирует порядок по тем пинам, что
// в неё попали, и остальные встанут задним числом ниже.
describe('dialogsManager.getDialogs: слияние страницы не трогает порядок закреплённых', () => {
  it('первая частичная страница НЕ засеивает pinnedOrders своими закреплёнными', async () => {
    const saved: Record<number, number[]>[] = []
    const mgr = newDialogsManager({
      // страница принесла ДВА закреплённых из четырёх, что есть на сервере
      rest: restStub({ chats: [raw(3, 3, { pinned: true }), raw(4, 4, { pinned: true })], count: 10, is_end: false }) as never,
      onDialogOps: () => {},
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
      savePinnedOrders: async (v) => { saved.push(v) },
    })

    await mgr.getDialogs({ limit: 4 })

    expect(saved).toEqual([]) // порядок закреплённых страницей не выводится
  })

  it('уже засеянный порядок страница, содержащая лишь часть закреплённых, не переписывает', async () => {
    const saved: Record<number, number[]>[] = []
    const mgr = newDialogsManager({
      rest: restStub({ chats: [raw(2, 2, { pinned: true }), raw(9, 9)], count: 10, is_end: false }) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, 1, { pinned: true }), dialog(2, 2, { pinned: true })],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
      savePinnedOrders: async (v) => { saved.push(v) },
    })
    await mgr.fillMirror() // засеял pinnedOrders = {0: [1, 2]}
    saved.length = 0

    await mgr.getDialogs({ limit: 5 })

    expect(saved).toEqual([])
    expect(mgr.getSnapshot().filter((i) => i.dialog.pinned).map((i) => i.dialog.chatId)).toEqual([1, 2])
  })
})

// Minor #4 (тот же гвард, что у refresh()): ответ страницы, отправленный под
// ПРОШЛЫМ токеном, к кэшу нового аккаунта не применяется.
describe('dialogsManager.getDialogs: поколение сессии гасит ответ прошлого аккаунта', () => {
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) await Promise.resolve() }

  it('resetForLogout() во время запроса страницы — ответ не применён и не отдан', async () => {
    let resolveGet!: (v: ChatsResponse) => void
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: { get: vi.fn(() => new Promise((res) => { resolveGet = res as never })) } as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, 1)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    await mgr.fillMirror()
    ops.length = 0

    const inflight = mgr.getDialogs({ limit: 5 })
    await tick()
    mgr.resetForLogout()
    resolveGet({ chats: [raw(5, 5)], count: 9, is_end: false })

    await expect(inflight).resolves.toEqual({ dialogs: [], count: 0, isEnd: false })
    expect(ops).toEqual([])
    expect(mgr.getSnapshot()).toEqual([])
  })

  // `loadedAll`/`contactIds` — тоже состояние ПРОШЛОГО аккаунта. Флаг пережил
  // бы логаут и заставил `getDialogs` нового пользователя отвечать «всё уже
  // загружено» из пустого кэша, ни разу не сходив в сеть; контакты дали бы
  // чужие правила фильтрации (их, в отличие от папок, никакая гидратация не
  // перечитывает — канал только `setContactIds`).
  it('resetForLogout() снимает loadedAll и контакты прошлого аккаунта', async () => {
    const rest = restStub({ chats: [raw(1, 1, { peer: { id: 7, display_name: 'c', avatar_url: '' } })], count: 1, is_end: true })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [folder({ id: 7, contacts: true })] }),
    })
    await mgr.refresh() // is_end без курсора → loadedAll
    mgr.setContactIds([7])
    expect((await mgr.getDialogs({ filterId: 7, limit: 10 })).dialogs.map((d) => d.chatId)).toEqual([1])
    rest.get.mockClear()

    mgr.resetForLogout()

    // Контактов больше нет — тот же диалог в папку «Контакты» не попадает.
    expect((await mgr.getDialogs({ filterId: 7, limit: 10 })).dialogs).toEqual([])
    // И список больше не считается загруженным целиком — окно шире кэша идёт в сеть.
    await mgr.getDialogs({ limit: 10 })
    expect(rest.get).toHaveBeenCalled()
  })
})
