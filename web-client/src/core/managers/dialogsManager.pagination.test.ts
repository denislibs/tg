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
import { DIALOG_LOAD_COUNT } from '../dialogs/loadCount'
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
    // Курсор к серверу — chatId последнего элемента выборки (отступление №1
    // спеки: у бэкенда нет понятия dialogIndex), а сама выборка объявлена
    // параметром `folder_id` (0 — всё, кроме архива).
    expect(rest.get).toHaveBeenCalledWith('/chats', { limit: 4, offset_chat_id: 1, folder_id: 0 })
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
  // `dialogpage.go` отдаёт страницу С НАЧАЛА → она не приносит ничего нового →
  // хвост кэша не двигается → следующий запрос уходит с ТЕМ ЖЕ
  // `offset_chat_id`. Без фолбэка список не продвинулся бы НИКОГДА.
  //
  // Лечение (спека «Размер набора и refresh()», отступление №3): одна страница БЕЗ курсора
  // увеличенного размера — она заведомо накрывает удерживаемое окно, то есть и
  // пересобирает голову выборки, и приносит хвост. Полным `refresh()` это
  // лечить больше нельзя: он ограничен тем же удерживаемым окном (Task 5) и
  // списка не продвигает.
  it('страница, не принёсшая ни одного нового диалога, лечится страницей БЕЗ курсора, а не залипает', async () => {
    const calls: (Record<string, number> | undefined)[] = []
    const rest = {
      get: vi.fn(async (_path: string, q?: Record<string, number>) => {
        calls.push(q)
        // страница по курсору — повтор уже известного (курсор не найден на сервере)
        if (q?.offset_chat_id) return { chats: [raw(2, 2), raw(1, 1)], count: 9, is_end: false }
        // страница без курсора (фолбэк) — выборка с начала
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

    expect(calls).toEqual([
      { limit: 3, offset_chat_id: 1, folder_id: 0 },
      // размер фолбэка — удерживаемое окно выборки (2) плюс запрошенное (3)
      { limit: 5, offset_chat_id: 0, folder_id: 0 },
    ])
    expect(page.dialogs.map((d) => d.chatId)).toEqual([3, 2, 1]) // список продвинулся
    expect(page.isEnd).toBe(true)
  })

  // Ревью Task 4, Important 1: у ПОЛЬЗОВАТЕЛЬСКОЙ папки выборка глобальная, и
  // курсор берётся из всего кэша — значит и фолбэк обязан просить окно ВСЕГО
  // КЭША, а не длины папки. Страница длиной с папку (тут — ноль подходящих
  // диалогов + limit) не дотягивается до залипшего чата, приносит только уже
  // известное, и папка навсегда остаётся с незаполняемыми плейсхолдерами.
  it('залипший курсор в пользовательской папке лечится окном всего кэша, а не длиной папки', async () => {
    // Сервер: 8 диалогов в глобальном порядке (chat 1 — самый свежий), группа
    // (единственный житель папки 7) — в самом хвосте.
    const server = Array.from({ length: 8 }, (_, i) => raw(i + 1, 8 - i, i === 7 ? { type: 'group' } : {}))
    const rest = {
      get: vi.fn(async (_path: string, q: Record<string, number>) => (q.offset_chat_id
        // опорный чат курсора исчез — страница приходит с начала и нового не несёт
        ? { chats: [raw(1, 8), raw(2, 7)], count: 40, is_end: false }
        : { chats: server.slice(0, q.limit), count: server.length, is_end: q.limit >= server.length })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      // держим три ГЛОБАЛЬНЫХ диалога, из которых в папку 7 не попадает ни один
      loadCache: async () => [dialog(1, 8), dialog(2, 7), dialog(3, 6)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [folder({ id: 7, groups: true })] }),
    })

    const page = await mgr.getDialogs({ limit: 5, filterId: 7 })

    // Фолбэк просит 3 (весь кэш) + 5, доходит до восьмого чата и приносит его;
    // по длине папки (0 + 5) страница закончилась бы на пятом, и папка осталась
    // бы пустой при завышенном count.
    expect(rest.get.mock.calls[1][1]).toEqual({ limit: 8, offset_chat_id: 0 })
    expect(page.dialogs.map((d) => d.chatId)).toEqual([8])
  })

  // Порт `count: loadedAll ? curDialogStorage.length : folder.count`
  // (dialogs.ts:1706): как только набор загружен целиком, размером служит
  // ДЛИНА КЭША, а серверный `count` прошлых страниц — устаревшее число.
  it('после refresh(), накрывшего набор, count — длина кэша, а не серверный count прошлой страницы', async () => {
    const rest = {
      // Страница «Всех чатов» уходит со своим `folder_id` (0), а `refresh()`
      // (Task 5) — по ГЛОБАЛЬНОЙ выборке, то есть с одним лишь `limit`: по
      // этому запросы и различаются, как их различает бэкенд.
      get: vi.fn(async (_path: string, q: Record<string, number>) => (q.folder_id === 0
        ? { chats: [raw(3, 3)], count: 137, is_end: false } // страница: сервер знает про 137
        : { chats: [raw(1, 1), raw(2, 2), raw(3, 3)], count: 3, is_end: true })), // окно refresh накрыло набор
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

  // Ревью Important 1 (снят Task 3, «Счётчик и загружено целиком — по
  // выборке»): раньше архив и пользовательская папка отдавали длину
  // отфильтрованного кэша — именно это давало «дырок не бывает по
  // определению» и глушило догрузку насмерть (см. докблок `countFor`).
  //
  // Task 4: страницы уходят со СВОИМ `folder_id`, поэтому серверный `count`
  // приходит по выборке — и ЗАВЫШЕННУЮ глобальную оценку заводит запрос
  // ГЛОБАЛЬНОЙ выборки, то есть страница пользовательской папки (её
  // `realFolderId` = GLOBAL, dialogs.ts:1646-1649). Пока своего ответа у
  // архива и «Всех чатов» нет, оба живут на этой оценке — как
  // пользовательская папка в оригинале живёт ПОСТОЯННО (dialogs.ts:1728).
  it('до собственного сетевого ответа архив и папка тоже берут завышенный глобальный count', async () => {
    const rest = restStub({ chats: [raw(9, 9)], count: 137, is_end: false })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [contactDialog, strangerDialog, dialog(3, 3, { archived: true })],
      // Папка 8 — близнец седьмой по правилу: в сеть она не сходит ни разу,
      // значит и `count` у неё может взяться только с чужой оценки.
      loadState: async () => ({
        pinnedOrders: {}, drafts: [] as Draft[],
        folders: [folder({ id: 7, nonContacts: true }), folder({ id: 8, nonContacts: true })],
      }),
    })
    mgr.setContactIds([7])
    await mgr.getDialogs({ filterId: 7, limit: 5 }) // глобальная выборка отдала count 137 (кэш стал 4)
    rest.get.mockClear()

    // Окна ниже умещаются в кэш — сеть больше не дёргается, сравниваем только count.
    expect((await mgr.getDialogs({ limit: 3 })).count).toBe(137) // «Все чаты» — на глобальной оценке
    expect((await mgr.getDialogs({ filterId: ARCHIVE_FOLDER_ID, limit: 1 })).count).toBe(137)
    // Папка 8 своего ответа не видела вовсе — живёт на оценке, оставленной
    // ответом папки 7 (выборка у обеих одна, глобальная; порт
    // `folder.count = result.count`, dialogs.ts:1728).
    expect((await mgr.getDialogs({ filterId: 8, limit: 1 })).count).toBe(137)
    expect(rest.get).not.toHaveBeenCalled()
  })

  // Порт `setDialogsLoaded(realFolderId=FOLDER_ID_ALL)` (dialogs.ts:276-288):
  // GLOBAL поднимает ОБЕ реальные папки разом. У архива в Task 3 своего
  // сетевого ответа нет (запрос без `folder_id`), но полный `refresh()`
  // обязан снять с него временную завышенную оценку тоже — иначе архив
  // навсегда остался бы «недогруженным» даже после того, как кэш уже
  // содержит его целиком.
  it('refresh(), покрывший весь набор, помечает загруженным и архив', async () => {
    const rest = restStub({ chats: [raw(1, 1), raw(2, 2, { archived: true })], count: 2, is_end: true })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    await mgr.refresh()
    rest.get.mockClear()

    const page = await mgr.getDialogs({ filterId: ARCHIVE_FOLDER_ID, limit: 5 })
    expect(rest.get).not.toHaveBeenCalled() // архив уже загружен целиком — в сеть не ходим
    expect(page.count).toBe(1) // длина архивного кэша, а не завышенная глобальная оценка
    expect(page.isEnd).toBe(true)
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

  // Симметрично 'all' выше: `dialogsLoaded.archive` — тоже состояние
  // ПРОШЛОГО аккаунта. Не снимись он при логауте, архив, помеченный
  // загруженным целиком ДО сброса, продолжил бы отвечать «уже всё есть» из
  // уже опустошённого кэша нового пользователя, ни разу не сходив в сеть.
  it('resetForLogout() снимает признак загруженности архива', async () => {
    const rest = restStub({ chats: [raw(1, 1, { archived: true })], count: 1, is_end: true })
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    await mgr.refresh() // is_end без курсора → загружены и «Все чаты», и архив
    rest.get.mockClear()

    mgr.resetForLogout()

    await mgr.getDialogs({ filterId: ARCHIVE_FOLDER_ID, limit: 10 })
    expect(rest.get).toHaveBeenCalled() // архив больше не считается загруженным
  })

  // Сброс флага «загружено» недостаточен сам по себе: `serverCount` — тоже
  // состояние ПРОШЛОГО аккаунта, и его завышенная оценка обязана уйти вместе
  // с ним, иначе просочится в count нового пользователя даже когда его кэш
  // уже умещает окно без сети.
  it('resetForLogout() снимает завышенный серверный count, а не только флаг загруженности', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(3, 3)], count: 137, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    await mgr.getDialogs({ limit: 5 }) // кэша (2) не хватает — сеть отдала count=137
    rest.get.mockClear()

    mgr.resetForLogout()

    // Кэш «холодного старта» нового аккаунта (та же loadCache-заглушка) снова
    // умещает окно без сети — но серверная оценка ПРОШЛОГО аккаунта не должна
    // просочиться в его count.
    const page = await mgr.getDialogs({ limit: 2 })
    expect(rest.get).not.toHaveBeenCalled()
    expect(page.count).toBe(2) // длина кэша, а не устаревшие 137
  })
})

describe('размер набора по выборке (порт dialogs.ts:1706,1728)', () => {
  // Пользовательская папка серверного набора не имеет: её размер — ЗАВЫШЕННАЯ
  // глобальная оценка (tweb dialogs.ts:1728), и именно она даёт дырку.
  it('пользовательская папка берёт глобальный count', async () => {
    const rest = {
      get: vi.fn(async () => ({ chats: [raw(1, 1)], count: 40, is_end: false })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    mgr.setContactIds([])
    // У менеджера нет отдельного `setFolders` — папки заводятся State-ключом
    // `folders` (тем же каналом, что и `pinnedOrders`/`drafts`, см. тест
    // «определения папок приезжают State-ключом folders» выше). Гидратация
    // ДО setStateKey обязательна: doHydrate() безусловно перечитывает `folders`
    // из loadState() и молча стёр бы значение, заданное раньше неё.
    await mgr.fillMirror()
    mgr.setStateKey('folders', [folder({ id: 7, groups: true })])

    const page = await mgr.getDialogs({ limit: 1, filterId: 7 })
    expect(page.count).toBe(40)
  })

  // Архив без собственного счётчика не создаёт дырок, а без дырок
  // requestItemForIdx не зовётся никогда — список не догружается вовсе.
  it('архив берёт count своей выборки, а не длину загруженного', async () => {
    const rest = {
      get: vi.fn(async (_p: string, q?: Record<string, string | number>) =>
        q?.folder_id === 1
          ? { chats: [raw(1, 1, { archived: true })], count: 9, is_end: false }
          : { chats: [raw(2, 2)], count: 40, is_end: false }),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    const page = await mgr.getDialogs({ limit: 1, filterId: ARCHIVE_FOLDER_ID })
    expect(page.count).toBe(9)
  })

  // Решётка setDialogsLoaded (dialogs.ts:276-299): обе реальные загружены —
  // загружен и глобальный набор, значит папка отвечает из памяти.
  it('загруженные ALL и ARCHIVE делают загруженным глобальный набор', async () => {
    const rest = {
      get: vi.fn(async (_p: string, q?: Record<string, string | number>) =>
        q?.folder_id === 1
          ? { chats: [raw(1, 1, { archived: true })], count: 1, is_end: true }
          : { chats: [raw(2, 2)], count: 1, is_end: true }),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      // Папки заводятся State-ключом `folders` — у менеджера нет отдельного
      // `setFolders`; здесь тест владеет `loadState`, поэтому определение
      // отдаётся сразу гидратацией (тот же приём, что в тестах фильтра папки
      // выше), а не досылается `setStateKey` после `fillMirror`.
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [folder({ id: 7, groups: true })] }),
    })
    mgr.setContactIds([])

    await mgr.getDialogs({ limit: 5, filterId: ARCHIVE_FOLDER_ID })
    await mgr.getDialogs({ limit: 5 })
    rest.get.mockClear()

    const page = await mgr.getDialogs({ limit: 5, filterId: 7 })
    expect(rest.get).not.toHaveBeenCalled()
    expect(page.isEnd).toBe(true)
  })

  // Обратная сторона той же решётки: ОДНА загруженная реальная папка
  // глобального набора не закрывает (`all && archive`, dialogs.ts:272-299) —
  // иначе пользовательская папка, чьи страницы вычерпывают глобальный набор,
  // навсегда осталась бы с тем, что успел набрать архив.
  it('загруженный архив сам по себе не делает загруженной выборку пользовательской папки', async () => {
    const rest = {
      get: vi.fn(async (_p: string, q?: Record<string, string | number>) =>
        q?.folder_id === 1
          ? { chats: [raw(1, 1, { archived: true })], count: 1, is_end: true }
          : { chats: [raw(2, 2, { type: 'group' })], count: 40, is_end: false }),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [folder({ id: 7, groups: true })] }),
    })

    await mgr.getDialogs({ limit: 5, filterId: ARCHIVE_FOLDER_ID }) // архив загружен целиком
    rest.get.mockClear()

    const page = await mgr.getDialogs({ limit: 5, filterId: 7 })
    expect(rest.get).toHaveBeenCalled() // «Все чаты» не загружены — папке есть куда идти
    expect(page.dialogs.map((d) => d.chatId)).toEqual([2])
  })

  it('страница архива уходит с folder_id=1 и курсором из архивной выборки', async () => {
    const rest = {
      get: vi.fn(async () => ({ chats: [raw(7, 7, { archived: true })], count: 9, is_end: false })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      // Хвост АРХИВА (chat_id 3) и хвост всего кэша (chat_id 1) обязаны
      // РАЗЛИЧАТЬСЯ: иначе тест не отличит курсор выборки от курсора кэша.
      loadCache: async () => [dialog(1, 1), dialog(3, 3, { archived: true }), dialog(5, 5, { archived: true })],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.getDialogs({ limit: 5, filterId: ARCHIVE_FOLDER_ID })

    // Курсор — хвост АРХИВНОЙ выборки (chat_id 3), а не всего кэша (1):
    // бэкенд ищет offset_chat_id внутри выборки и чужой id трактует как
    // «с начала» (dialogpage.go), то есть страница повторилась бы вечно.
    expect(rest.get).toHaveBeenCalledWith('/chats', expect.objectContaining({ folder_id: 1, offset_chat_id: 3 }))
  })

  it('страница пользовательской папки уходит БЕЗ folder_id (глобальный набор)', async () => {
    const rest = {
      get: vi.fn(async (_p: string, _q?: Record<string, string | number>) => ({ chats: [raw(5, 5)], count: 40, is_end: false })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [dialog(1, 1), dialog(2, 2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [folder({ id: 7, groups: true })] }),
    })
    mgr.setContactIds([])

    await mgr.getDialogs({ limit: 5, filterId: 7 })

    const q = rest.get.mock.calls[0][1] as Record<string, unknown>
    expect(q.folder_id).toBeUndefined()
    // И курсор — хвост ВСЕГО кэша (chat_id 1): выборка папки и есть глобальная.
    expect(q.offset_chat_id).toBe(1)
  })

  // Тот же порт `dialogsLength >= count`, что у «Всех чатов» (см. «страница по
  // курсору, закрывшая набор» выше), но сверяется РАЗМЕР СВОЕЙ ВЫБОРКИ: `count`
  // архивной страницы описывает архив, и мерить его длиной всего кэша (где
  // львиная доля — неархивные) значит объявить архив загруженным, держа два
  // диалога из пяти.
  it('конец архивной страницы сверяется с размером архивной выборки, а не всего кэша', async () => {
    const rest = {
      get: vi.fn(async () => ({ chats: [raw(5, 5, { archived: true })], count: 5, is_end: true })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      // Весь кэш (4) вместе со страницей дорастает до серверного count архива
      // (5), но самой архивной выборки в нём — один диалог до страницы и два
      // после.
      loadCache: async () => [dialog(1, 1), dialog(2, 2), dialog(4, 4), dialog(3, 3, { archived: true })],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.getDialogs({ limit: 2, filterId: ARCHIVE_FOLDER_ID }) // держим 2 архивных из 5
    rest.get.mockClear()

    const page = await mgr.getDialogs({ limit: 10, filterId: ARCHIVE_FOLDER_ID })
    expect(rest.get).toHaveBeenCalled() // архив загруженным целиком не считается
    expect(page.count).toBe(5)
  })

  // is_end архивной страницы не имеет права объявить загруженным весь набор.
  it('is_end архивной страницы не поднимает загруженность «Всех чатов»', async () => {
    const rest = {
      get: vi.fn(async () => ({ chats: [raw(5, 5, { archived: true })], count: 1, is_end: true })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.getDialogs({ limit: 5, filterId: ARCHIVE_FOLDER_ID })
    rest.get.mockClear()
    await mgr.getDialogs({ limit: 5 }) // «Все чаты» — обязаны пойти в сеть

    expect(rest.get).toHaveBeenCalled()
  })
})

// Порт `dialogsOffsetDate` (dialogs.ts:80,386-393,1052-1058 +
// appMessagesManager.ts:3534): смещение пагинации хранится ПО ВЫБОРКЕ, и
// страница чужой папки его не двигает. Пока курсор выводился из хвоста кэша,
// этого различия не было — а кэш наполняют три выборки сразу (Task 4).
describe('курсор пагинации — свой у каждой выборки', () => {
  it('страница архива не сбивает курсор глобальной выборки', async () => {
    const rest = {
      get: vi.fn(async (_p: string, q: Record<string, number>) => (q.folder_id === 1
        // Архив: единственный диалог, и он САМЫЙ СТАРЫЙ в глобальном порядке,
        // то есть после слияния окажется в хвосте кэша.
        ? { chats: [raw(99, 1, { archived: true })], count: 1, is_end: true }
        : { chats: [raw(1, 9), raw(2, 8)], count: 40, is_end: false })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [folder({ id: 7, groups: true })] }),
    })

    await mgr.refresh() // глобальная выборка вычерпана до чата 2
    await mgr.getDialogs({ filterId: ARCHIVE_FOLDER_ID, limit: 5 }) // архив положил в кэш чат 99
    rest.get.mockClear()

    // Страница пользовательской папки идёт по ГЛОБАЛЬНОЙ выборке и обязана
    // продолжить с чата 2 — там, где остановилась её пагинация. С курсором из
    // хвоста кэша сюда уехал бы архивный чат 99, то есть конец набора, и папка
    // не получила бы больше ни одного диалога.
    await mgr.getDialogs({ filterId: 7, limit: 5 })

    expect(rest.get).toHaveBeenCalledWith('/chats', { limit: 5, offset_chat_id: 2 })
  })

  it('вторая страница продолжает с того, чем кончилась ПЕРВАЯ, а не с хвоста кэша', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(5, 5), raw(4, 4)], count: 40, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      // В кэше прошлой сессии — САМЫЙ СТАРЫЙ диалог: после слияния страницы он
      // остаётся в хвосте, то есть хвост кэша и хвост страницы РАЗЪЕЗЖАЮТСЯ.
      loadCache: async () => [dialog(1, 1)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.getDialogs({ limit: 2 }) // первая страница: курсор встал на чате 4
    rest.get.mockClear()

    await mgr.getDialogs({ limit: 5 })

    // Курсор — конец ПАГИНАЦИИ (4), а не хвост кэша (1): после чата 1 сервер
    // отдал бы пустоту, страница не приносила бы нового, и список замер бы.
    expect(rest.get).toHaveBeenCalledWith('/chats', { limit: 5, offset_chat_id: 4, folder_id: 0 })
  })

  // Порт `if(!savedOffsetDate || offsetDate < savedOffsetDate)`
  // (dialogs.ts:1060-1066): смещение двигается только ВГЛУБЬ. Окно `refresh()`
  // всегда читается от начала выборки, и без этого правила оно откатывало бы
  // курсор наверх — следующая страница папки приносила бы уже известное
  // (`added === 0`), а это фолбэк залипшего курсора, то есть лишний запрос на
  // всё удерживаемое окно.
  it('окно refresh() не откатывает курсор, ушедший глубже', async () => {
    const rest = {
      get: vi.fn(async (_p: string, q: Record<string, number>) => (q.offset_chat_id
        ? { chats: [raw(3, 5), raw(4, 4)], count: 40, is_end: false }
        : { chats: [raw(1, 7), raw(2, 6)], count: 40, is_end: false })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[], folders: [folder({ id: 7, groups: true })] }),
    })

    await mgr.refresh() // курсор глобальной выборки: чат 2
    await mgr.getDialogs({ filterId: 7, limit: 5 }) // ...ушёл глубже: чат 4
    await mgr.refresh() // окно снова читает голову — курсор обязан остаться на 4
    rest.get.mockClear()

    await mgr.getDialogs({ filterId: 7, limit: 9 })

    expect(rest.get).toHaveBeenCalledWith('/chats', { limit: 9, offset_chat_id: 4 })
  })

  // Опорным для курсора берётся последний диалог ВРЕМЕННОГО ПОТОКА, а не
  // страницы (порт `if(offsetDate && !dialog.pFlags.pinned)`, dialogs.ts:1051).
  it('курсор не встаёт на закреплённый — он в серверном порядке вне времени', async () => {
    const rest = {
      get: vi.fn(async (_p: string, q: Record<string, number>) => (q.offset_chat_id
        ? { chats: [raw(9, 9, { pinned: true })], count: 40, is_end: false }
        : { chats: [raw(1, 5), raw(2, 4)], count: 40, is_end: false })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh() // курсор: чат 2 (низ потока)
    await mgr.getDialogs({ limit: 5 }) // страница принесла ОДИН закреплённый
    rest.get.mockClear()

    await mgr.getDialogs({ limit: 9 })

    // Курсор остался на 2: встань он на закреплённый (сервер ставит его ПЕРВЫМ
    // при любом времени), следующая страница пошла бы от вершины набора.
    expect(rest.get).toHaveBeenCalledWith('/chats', { limit: 9, offset_chat_id: 2, folder_id: 0 })
  })

  // Диалог без последнего сообщения (очищенная история) даёт `at === 0`, и
  // правило «только вглубь» после него не выполнилось бы уже НИКОГДА: каждая
  // следующая страница уходила бы с тем же `offset_chat_id`.
  it('курсор не встаёт на диалог без последнего сообщения и не замерзает', async () => {
    const rest = {
      get: vi.fn(async (_p: string, q: Record<string, number>) => (q.offset_chat_id
        ? { chats: [raw(3, 3), raw(9, 1, { last_message: undefined })], count: 40, is_end: false }
        : { chats: [raw(1, 5), raw(2, 4)], count: 40, is_end: false })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()
    await mgr.getDialogs({ limit: 5 }) // хвост страницы — очищенный чат 9
    rest.get.mockClear()

    await mgr.getDialogs({ limit: 9 })

    // Курсор продвинулся до чата 3 (низ потока), а не залип на `at: 0` чата 9.
    expect(rest.get).toHaveBeenCalledWith('/chats', { limit: 9, offset_chat_id: 3, folder_id: 0 })
  })

  // Курсор — `chat_id`, и он обязан ЛЕЖАТЬ в кэше своей выборки: опорный чат,
  // которого мы больше не держим (разархивирован, удалён, выпал при слиянии
  // окна), просит у сервера продолжение с места, которого у нас нет, — голова
  // выборки навсегда осталась бы дырками. Фолбэк залипшего курсора это не
  // ловит: он срабатывает по `added === 0`, а такая страница исправно приносит
  // новое (только не то, чего не хватает).
  it('курсор, ушедший из выборки, не используется — страница идёт от хвоста выборки', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(30, 3, { archived: true })], count: 9, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [dialog(5, 5, { archived: true })],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.getDialogs({ filterId: ARCHIVE_FOLDER_ID, limit: 2 }) // курсор архива встал на чате 30
    mgr.applyArchived(30, false) // ...и тут же ушёл из архивной выборки
    rest.get.mockClear()

    await mgr.getDialogs({ filterId: ARCHIVE_FOLDER_ID, limit: 5 })

    expect(rest.get).toHaveBeenCalledWith('/chats', { limit: 5, offset_chat_id: 5, folder_id: 1 })
  })

  it('resetForLogout() сбрасывает курсоры: первая страница нового аккаунта идёт от начала', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 9), raw(2, 8)], count: 40, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })
    await mgr.getDialogs({ limit: 2 }) // курсор выборки «Все чаты» встал на чате 2
    rest.get.mockClear()

    mgr.resetForLogout()

    // `chatId` прошлого аккаунта бэкенд в выборке нового не найдёт и молча
    // отдаст страницу с начала — просить её надо явно, без курсора.
    await mgr.getDialogs({ limit: 5 })
    expect(rest.get).toHaveBeenCalledWith('/chats', { limit: 5, offset_chat_id: 0, folder_id: 0 })
  })
})

// Полная подмена коллекции запрещена (web-client/CLAUDE.md, «НЕЛЬЗЯ»), и со
// страничным окном это перестало быть теорией: окно `refresh()` — только голова
// ГЛОБАЛЬНОЙ выборки, а ниже неё живут архив и глубокие страницы папок.
describe('refresh сливает окно с кэшем, а не подменяет список', () => {
  /** Кэш: голова глобальной выборки (свежие) + архивный диалог глубоко внизу. */
  const cachedTail = () => [dialog(1, 9), dialog(2, 8), dialog(50, 1, { archived: true })]

  it('диалоги ниже окна переживают ответ', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 9), raw(2, 8)], count: 40, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => cachedTail(),
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    // Архивный чат 50 в окно не попал (он старше всего окна) — и остался.
    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([1, 2, 50])
  })

  // Ремонт после разрыва потока апдейтов (`rt:resync`): кадр `chat_removed`,
  // потерянный в разрыве, уже не придёт, и сверка с ответом — единственный
  // способ снять исчезнувший диалог.
  it('диалог, пропавший ВНУТРИ окна, из кэша снимается', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 9), raw(3, 7)], count: 40, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      // Чат 2 лежит между 1 и 3 по времени — сервер обязан был бы его вернуть.
      loadCache: async () => [dialog(1, 9), dialog(2, 8), dialog(3, 7), dialog(50, 1)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([1, 3, 50])
  })

  // Сравнение идёт по времени последнего сообщения (ключ СЕРВЕРНОГО порядка), а
  // не по `dialogIndex`: черновик поднимает диалог только у нас, сервер про него
  // не знает и в окно его не клал.
  it('диалог, поднятый локальным черновиком, окном не снимается', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 9), raw(2, 7)], count: 40, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      // Черновик ВНУТРИ окна по времени (8-е между 9-м и 7-м), а само последнее
      // сообщение чата 7 — глубоко под окном: по `dialogIndex` он попал бы в
      // окно и был бы снят, по серверному ключу — нет.
      loadCache: async () => [dialog(1, 9), dialog(2, 7), dialog(7, 1)],
      loadState: async () => ({
        pinnedOrders: {},
        drafts: [{ chatId: 7, text: 'ч', replyToId: null, updatedAt: at(8) }] as Draft[],
      }),
    })

    await mgr.refresh()

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toContain(7)
  })

  // Обратная сторона: диалог, поднявшийся ВЫШЕ окна уже после того, как сервер
  // собрал ответ (пришло realtime-сообщение), сервер вернуть не мог.
  it('диалог свежее всего окна не снимается', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 8), raw(2, 7)], count: 40, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [dialog(9, 9), dialog(1, 8), dialog(2, 7)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([9, 1, 2])
  })

  // Порядок сервера — `pinned_at DESC NULLS LAST, lm.created_at DESC NULLS
  // LAST, c.id DESC` (chatsrepo.go:229), то есть страница НЕ является
  // непрерывным временным отрезком: закреплённый идёт первым с любым временем
  // последнего сообщения. Считая границы по нему, окно проваливалось бы до его
  // старой метки и сносило всё живое ниже (порт гварда `if(offsetDate &&
  // !dialog.pFlags.pinned)`, dialogs.ts:1051).
  it('закреплённый со СТАРЫМ сообщением не расширяет окно и не сносит живые диалоги ниже', async () => {
    const rest = {
      get: vi.fn(async () => ({
        chats: [raw(100, 1, { pinned: true }), raw(1, 9), raw(2, 8)],
        count: 40, is_end: false,
      })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      // 50 и 51 лежат ПОД окном (дни 5 и 4) — их принесла догрузка папки/архива.
      loadCache: async () => [dialog(1, 9), dialog(2, 8), dialog(50, 5), dialog(51, 4)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId).sort((a, b) => a - b)).toEqual([1, 2, 50, 51, 100])
  })

  // Тот же класс, вырожденный: закреплённый без последнего сообщения (легальное
  // состояние — «очистить историю», `cleared_max_seq`, chatsrepo.go:213) дал бы
  // нижнюю границу 0, окно накрыло бы ВЕСЬ кэш, и слияние выродилось бы обратно
  // в полную подмену.
  it('закреплённый БЕЗ последнего сообщения не обнуляет нижнюю границу', async () => {
    const rest = {
      get: vi.fn(async () => ({
        chats: [raw(100, 1, { pinned: true, last_message: undefined }), raw(1, 9), raw(2, 8)],
        count: 40, is_end: false,
      })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [dialog(1, 9), dialog(2, 8), dialog(50, 5), dialog(51, 4)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId).sort((a, b) => a - b)).toEqual([1, 2, 50, 51, 100])
  })

  // Тайбрейк сервера — `c.id DESC` (chatsrepo.go:229): сосед с той же меткой
  // времени мог оказаться сразу ЗА срезом страницы, и его отсутствие в ответе
  // ничего не доказывает.
  it('ничья по времени на нижней границе окна не снимает диалог', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 9), raw(2, 8)], count: 40, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      // У чата 3 РОВНО то же время, что у нижнего диалога окна (день 8).
      loadCache: async () => [dialog(1, 9), dialog(2, 8), dialog(3, 8)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toContain(3)
  })

  // Вне временного потока — вне правила: у закреплённого место в порядке задаёт
  // `pinned_at`, у очищенного его нет вовсе, поэтому «должен был вернуться, но
  // не вернулся» про них не выводится. Их фантомы снимает свой канал
  // (`applyRemoved`) или ответ с `is_end` — цена сознательная, ложное удаление
  // живого диалога дороже.
  it('закреплённый и очищенный, пропавшие из ответа, правилом не снимаются', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 9), raw(2, 7)], count: 40, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [
        dialog(1, 9), dialog(2, 7),
        dialog(70, 8, { pinned: true }), // закреплённый СТРОГО внутри окна (9 > 8 > 7)
        mapDialog(raw(71, 8, { last_message: undefined })), // и очищенный
      ],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    const ids = mgr.getSnapshot().map((i) => i.dialog.chatId)
    expect(ids).toContain(70)
    expect(ids).toContain(71)
  })

  // Вырожденный случай той же категории: ВО ВСЁМ ответе ни одного диалога
  // временного потока (у пользователя первые страницы заняты закреплёнными, а
  // истории у них очищены). Границ окна нет вовсе — сверять не с чем, ответ
  // просто СЛИВАЕТСЯ с кэшем, и слияние обязано остаться дедуплицированным:
  // диалог, пришедший в ответе, во второй раз из кэша не берётся.
  it('ответ без единого диалога временного потока сливается с кэшем без дублей', async () => {
    const rest = {
      get: vi.fn(async () => ({
        chats: [raw(1, 9, { pinned: true }), raw(2, 8, { last_message: undefined })],
        count: 40, is_end: false,
      })),
    }
    const mgr = newDialogsManager({
      rest: rest as never,
      // Чат 1 уже в кэше (ответ принесёт его свежую версию), 50 и 51 — ниже.
      loadCache: async () => [dialog(1, 9, { pinned: true }), dialog(50, 5), dialog(51, 4)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId).sort((a, b) => a - b)).toEqual([1, 2, 50, 51])
  })

  // `is_end` без курсора — ответ и есть ВЕСЬ набор: всё, чего в нём нет, ушло.
  it('окно с is_end заменяет список целиком', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 9)], count: 1, is_end: true })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => cachedTail(),
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([1])
  })

  // Контракт Task 4: ЕДИНСТВЕННЫЙ до этой строки писатель `serverCount.global` —
  // страница пользовательской папки, а её на холодном старте может не быть
  // вовсе. Без записи из `refresh()` архив и «Все чаты» остались бы без
  // завышенной оценки, то есть без дырок, то есть без догрузки.
  it('count окна становится глобальной оценкой размера набора', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 9)], count: 200, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()
    rest.get.mockClear()

    // Окно умещается в кэш — сеть не дёргается, сравниваем только `count`.
    const page = await mgr.getDialogs({ limit: 1 })
    expect(rest.get).not.toHaveBeenCalled()
    expect(page.count).toBe(200) // без записи здесь была бы длина кэша (1)
  })
})

describe('refresh перечитывает удерживаемое окно, а не весь список', () => {
  // Холодный старт: держим ноль — просим первую страницу. Без этого boot
  // тянет всю ленту диалогов одним ответом и глушит пагинацию на весь сеанс.
  it('на пустом кэше просит одну страницу', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 1)], count: 200, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(rest.get).toHaveBeenCalledWith('/chats', expect.objectContaining({ limit: DIALOG_LOAD_COUNT }))
  })

  it('на прогретом кэше просит ровно столько, сколько держит', async () => {
    const cached = Array.from({ length: 37 }, (_, i) => dialog(i + 1, 1))
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 1)], count: 200, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => cached,
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()

    expect(rest.get).toHaveBeenCalledWith('/chats', expect.objectContaining({ limit: 37 }))
  })

  // Ответ без is_end больше не считается полным набором — иначе первый же из
  // девятнадцати колсайтов refresh() глушил бы догрузку до конца сеанса.
  it('ответ без is_end не объявляет набор загруженным', async () => {
    const rest = { get: vi.fn(async () => ({ chats: [raw(1, 1)], count: 200, is_end: false })) }
    const mgr = newDialogsManager({
      rest: rest as never,
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] as Draft[] }),
    })

    await mgr.refresh()
    rest.get.mockClear()
    await mgr.getDialogs({ limit: 5 })

    expect(rest.get).toHaveBeenCalled()
  })
})
