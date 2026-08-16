// Владелец списка диалогов (порт модели tweb: dialogsStorage живёт в воркере
// вместе с generateDialogIndex, черновиками и порядком закреплённых).
// Витрина (`stores/chatsStore.ts`) — зеркало, её единственный писатель — проектор.
//
// Отступление от tweb: у них представление — сам DOM, которым владеет
// SortedDialogList, массива диалогов на main нет; у нас представление — React,
// читающий из стора, поэтому зеркало массивом. См. спеку
// docs/superpowers/specs/2026-08-12-dialogs-ownership-and-virtual-list-design.md.
import type { RestClient } from '../net/restClient'
import { HttpError } from '../net/restClient'
import { mapDialog, type Dialog, type Draft, type RawDialog } from '../models'
import { dialogIndex } from '../dialogs/dialogIndex'
import { DIALOG_LOAD_COUNT } from '../dialogs/loadCount'
import type { DialogItem, DialogOp } from '../dialogs/dialogOps'
import type { NewMessageEvt, ReadEvt, ChatUpdateEvt } from '../realtime/events'
import { equal } from '../store/reconcile'
import { dialogMatchesFolder } from '../folderFilter'
// Наше закрепление пер-юзерное и на весь список сразу — запись одна (см.
// chatsStore), поэтому `pinnedOrders` ключуется тем же ALL_FOLDER_ID.
// Обе константы — общий дом core/folderIds.ts (их читает и main, и воркер).
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '../folderIds'
import type { Folder } from './foldersManager'

/** Размер страницы по умолчанию — как в tweb (`limit = 20`, dialogs.ts:1614). */
const DEFAULT_LIMIT = 20

/** Ответ `getDialogs` — контракт 1:1 с tweb (dialogs.ts:1605-1610, без isTopEnd:
 * его считает потребитель-виртуализатор, этап 3). */
export type DialogsPage = { dialogs: Dialog[]; count: number; isEnd: boolean }

/** Ответ `GET /chats` в форме Task 3 (`chat_handler.go::ListDialogs`). */
type ChatsResponse = { chats?: RawDialog[]; count?: number; is_end?: boolean }

export interface DialogsDeps {
  rest: Pick<RestClient, 'get'>
  onDialogOps?: (ops: DialogOp[]) => void
  /** офлайн-кэш прошлой сессии (persist.loadDialogs) */
  loadCache: () => Promise<Dialog[]>
  /**
   * Ключи State, от которых зависит порядок (persist.loadStateAll), и —
   * этап 2 — определения папок: фильтр папки считается в воркере
   * (`getDialogs({filterId})`), а на холодном старте State никто не ПИШЕТ
   * (boot.ts поднимает его с диска через `setAppStateSilent`), поэтому канала
   * `setStateKey` для первого кадра мало. `folders` опционален по тому же
   * приёму, что `getMeId`/`savePinnedOrders`: тесты, которых папки не
   * касаются, его не задают.
   */
  loadState: () => Promise<{ pinnedOrders: Record<number, number[]>; drafts: Draft[]; folders?: Folder[] }>
  /** id текущего пользователя — нужен applyNewMessage (не бампить бейдж на своё же
   * эхо). Разрешается лениво (воркер узнаёт `me` асинхронно), поэтому геттер, а не
   * значение — тот же приём, что у `newMessagesManager` (messagesManager.ts). */
  getMeId?: () => number | null
  /**
   * Task 4 (действия без оптимистики): `applyPinned` двигает порядок закреплённых
   * и обязан и записать новый `pinnedOrders` на диск, и разослать зеркало ключа
   * остальным вкладкам — тем же путём, что `persistManager.stateKey`
   * (`saveStateKey` + `mirrorStateKey` в workerCore.ts), второй писатель того же
   * ключа не заводится. Опциональны по тому же приёму, что `getMeId` выше: тесты,
   * которых `applyPinned` не касается, их не задают.
   */
  savePinnedOrders?: (value: Record<number, number[]>) => Promise<void>
  mirrorStateKey?: (key: string, value: unknown) => void
  /**
   * Task 5 (персист переезжает к владельцу): физический writer офлайн-кэша
   * списка (`persist.saveDialogs`, подставляется в workerCore.ts). Раньше
   * снапшот собирала main-thread-подписка `stores/dialogsPersist.ts`
   * (дебаунс поверх зеркала chatsStore) и слала его воркеру RPC'ом; теперь
   * владелец — источник данных — пишет сам, тем же дебаунсом, что был там
   * (см. `scheduleSave` ниже). Опционален по тому же приёму, что и
   * `savePinnedOrders`/`mirrorStateKey`: тесты, которых персист не касается,
   * его не задают.
   */
  saveCache?: (dialogs: Dialog[]) => Promise<void>
  /**
   * Task 6 (диалоговая половина `loadChats` переезжает к владельцу): дешифровка
   * превью секретных чатов на холодном старте/сетевом догоне (порт
   * `chatsStore.decryptSecretPreviews`, main). Текст секретного сообщения
   * приходит с сервера как `enc_body`, plaintext знает только WebCrypto-ключ
   * секретного чата — тот живёт в `secretManager` (workerCore.ts), в ТОМ ЖЕ
   * воркере, поэтому RPC (как было с main) больше не нужен. Опционален по тому
   * же приёму, что `getMeId`/`savePinnedOrders` выше: тесты, которых секретные
   * чаты не касаются, его не задают.
   */
  decryptSecret?: (chatId: number, encBody: string) => Promise<{ text: string; media?: { mediaType: string } } | null>
}

/** Тот же интервал, что был у main-thread-дебаунса `dialogsPersist.ts` (800мс)
 * — с запасом округлён до секунды, чтобы серия частых patch'ей (realtime-
 * поток) схлопывалась в одну запись, а не открывала readwrite-транзакцию на
 * каждое изменение. */
const PERSIST_DEBOUNCE_MS = 1000

export function newDialogsManager({ rest, onDialogOps, loadCache, loadState, getMeId, savePinnedOrders, mirrorStateKey, saveCache, decryptSecret }: DialogsDeps) {
  let items: DialogItem[] = []
  // Полный State-ключ (все папки) — нужен целиком, чтобы applyPinned не затёр
  // чужие записи при записи на диск (порт tweb: `{...orders, [ALL_FOLDER_ID]: …}`,
  // см. прежний chatsStore.setDialogPinned). `pinnedOrder` — производная для
  // ТЕКУЩЕЙ (единственной) папки, ей пользуется dialogIndex().
  let pinnedOrders: Record<number, number[]> = {}
  let pinnedOrder: number[] = []
  let drafts: Draft[] = []
  // Этап 2 (пагинация): входы фильтра папок. Определения — State-ключ `folders`
  // (диск при гидрации + `setStateKey` на изменение), контакты — отдельный
  // сеттер `setContactIds` (владения контактами этот этап не заводит, см. спеку
  // «Фильтр папки переезжает в воркер»).
  let folders: Folder[] = []
  let contactIds: ReadonlySet<number> = new Set()
  /**
   * Контакты УЖЕ приезжали (пусть даже пустым списком) — третье состояние, без
   * которого пустой `contactIds` неотличим от «контактов ещё нет».
   *
   * Порт гарантии оригинала: tweb перед фильтрацией непользовательской папки
   * ЖДЁТ `fillContacts()` и только потом считает (`dialogs.ts:1625-1642`). У
   * нас контакты приезжают пушем (`stores/foldersStore.ts::loadFolders` →
   * `setContactIds`), ждать нечего — значит нужен признак «данных ещё не
   * было»: иначе правило `contacts`/`non_contacts` МОЛЧА даёт неверную
   * страницу (все — не-контакты), а это хуже пустой (см. forFilter).
   */
  let contactsKnown = false
  /**
   * Выборка запроса — порт tweb `realFolderId` (dialogs.ts:1646-1649).
   * Реальных папок на сервере две, «все чаты» и «архив»; пользовательская
   * папка — клиентский фильтр, её страницы вычерпывают ГЛОБАЛЬНЫЙ набор.
   */
  type Scope = 'global' | 'all' | 'archive'
  const scopeFor = (filterId: number): Scope =>
    filterId === ALL_FOLDER_ID ? 'all' : filterId === ARCHIVE_FOLDER_ID ? 'archive' : 'global'
  /**
   * Номер выборки НА ПРОВОДЕ — порт tweb `FOLDER_ID_ALL`/`FOLDER_ID_ARCHIVE`
   * (appManagers/constants.ts:37-39), он же параметр `folder_id` нашего
   * `/chats` (`0` — всё, кроме архива; `1` — только архив; параметра нет — весь
   * набор). `undefined` у глобальной выборки — это и есть tweb'ский
   * `GLOBAL_FOLDER_ID` (dialogs.ts:1646-1649): запрос уходит БЕЗ папки.
   *
   * Наш `ARCHIVE_FOLDER_ID` (-1) с проводным `1` не совпадает сознательно —
   * см. докблок константы в `core/folderIds.ts`: id папок раздаёт Postgres с
   * единицы, поэтому псевдо-id архива у нас отрицательный, а на проводе
   * остаётся telegram'овская единица.
   */
  const WIRE_FOLDER: Record<Scope, number | undefined> = { global: undefined, all: 0, archive: 1 }

  /**
   * Выборка загружена ЦЕЛИКОМ — порт `allDialogsLoaded` (dialogs.ts:272-299).
   * Хранятся только две реальные папки, глобальная выводится: у tweb под неё
   * есть отдельное поле, поддерживаемое в согласии с двумя реальными, — то же
   * значение, лишнее состояние (спека, «Отступления» №2).
   */
  const dialogsLoaded: Record<'all' | 'archive', boolean> = { all: false, archive: false }
  const isLoaded = (scope: Scope): boolean =>
    scope === 'global' ? dialogsLoaded.all && dialogsLoaded.archive : dialogsLoaded[scope]
  /** Порт `setDialogsLoaded` (dialogs.ts:276-288): GLOBAL поднимает обе реальные. */
  function setLoaded(scope: Scope): void {
    if (scope === 'global') { dialogsLoaded.all = true; dialogsLoaded.archive = true }
    else dialogsLoaded[scope] = true
  }

  /** `count` последнего сетевого ответа ПО ВЫБОРКЕ (аналог tweb
   *  `getFolder(filterId).count`); `null` — этой выборки сеть ещё не видела. */
  const serverCount: Record<Scope, number | null> = { global: null, all: null, archive: null }

  /**
   * Докуда дочерпала пагинация ВЫБОРКИ: `chatId` последнего диалога последней
   * её страницы и его время — `null`, пока страниц этой выборки не было.
   *
   * Порт `dialogsOffsetDate` (dialogs.ts:80,386-393,1052-1058): смещение там
   * тоже хранится ПО ПАПКЕ, а не выводится из кэша, и страница чужой папки его
   * не двигает — `saveGlobalOffset = ... || folderId === GLOBAL_FOLDER_ID`
   * (appMessagesManager.ts:3534) прямо запрещает странице архива сдвигать
   * ГЛОБАЛЬНОЕ смещение.
   *
   * Почему это обязательно у нас: кэш наполняют ТРИ выборки (Task 4), и
   * страница архива кладёт в него старый архивный диалог — то есть в хвост
   * ГЛОБАЛЬНОГО порядка. Пока курсор выводился из хвоста кэша, глобальная
   * выборка после первой же страницы архива просила «всё, что после самого
   * старого архивного», то есть пустоту, — и пользовательская папка (её
   * выборка глобальная) не получала больше ни одного диалога.
   *
   * Время хранится РЯДОМ с id, потому что курсор двигается только ВГЛУБЬ —
   * порт `if(!savedOffsetDate || offsetDate < savedOffsetDate)`
   * (dialogs.ts:1060-1066). У оригинала смещение и есть дата, у нас на проводе
   * `chat_id`, сравнивать которые бессмысленно, — отсюда пара. Без правила
   * «только вглубь» окно `refresh()` (оно всегда от начала выборки) откатывало
   * бы курсор наверх, и следующая страница папки приносила бы уже известное:
   * `added === 0` → фолбэк залипшего курсора → лишний запрос на всё окно.
   */
  const serverCursor: Record<Scope, { chatId: number; at: number } | null> = { global: null, all: null, archive: null }
  let hydrated = false
  // Промис гидратации в полёте (а не булев флаг): конкурентный fillMirror()/
  // refresh() — две вкладки поднимают общий SharedWorker одновременно, либо оба
  // метода зовутся почти сразу друг за другом — обязан ждать РЕЗУЛЬТАТ первого
  // вызова, а не проскакивать мимо него. Флаг `hydrated=true`, выставленный
  // синхронно ДО await, давал второму вызову увидеть «уже гидратировано» и
  // разослать пустой reset раньше, чем первый успел загрузить кэш/State — этот
  // дефект воспроизведён и закрыт тестом «конкурентный fillMirror не рассылает
  // пустой reset» (dialogsManager.test.ts). `null` после промаха — гидратация
  // упавшая (оффлайн/битый IDB) обязана даться повторить, а не залипнуть на
  // вечно отклонённом промисе (см. тест «упавшая гидратация не залипает»).
  let hydrating: Promise<void> | null = null
  // Task 5: таймер отложенной записи кэша (см. scheduleSave/cancelPersist).
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Fix (финальное ревью, Minor #4): поколение сессии. `resetForLogout()`
   * опустошает кэш синхронно, но НЕ гасит уже улетевшие `hydrate()`/`refresh()`
   * — чтение диска и ответ `/chats`, отправленный под ПРОШЛЫМ токеном, придут
   * уже после смены сессии и без гварда применились бы к кэшу нового аккаунта и
   * разошлись бы веером по вкладкам. Приём — тот же `downloadGen` у медиа
   * (`mediaManager.ts::downloadMediaURL`/`resetDownloads`): поколение снимается
   * в момент ЗАПУСКА операции и сверяется перед записью/публикацией.
   */
  let sessionGen = 0

  /** Схлопнуть серию публикаций в одну запись на диск (см. докблок `saveCache`
   * в DialogsDeps). Каждый publish() двигает окно — итоговая запись случится
   * один раз, через PERSIST_DEBOUNCE_MS ПОСЛЕ ПОСЛЕДНЕЙ операции серии,
   * последняя правка при этом не теряется (пишем `items` в момент срабатывания
   * таймера, а не в момент планирования). */
  function scheduleSave(): void {
    if (!saveCache) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveCache(items.map((i) => i.dialog))
    }, PERSIST_DEBOUNCE_MS)
  }

  /**
   * Разослать операции вкладкам, НЕ трогая диск. Fix (финальное ревью,
   * Important #4): запись на диск — следствие изменения ЗНАЧЕНИЙ кэша, а не
   * самого факта рассылки. Два колсайта объявляют операцию, ничего в значениях
   * не меняя, и обязаны идти этим путём:
   *  - `fillMirror()` — данные только что прочитаны с ТОГО ЖЕ диска, планировать
   *    обратную запись нечего;
   *  - `reindex` из `setStateKey()` — меняется порядок (производная от
   *    State-ключей `pinnedOrders`/`drafts`), а на диск идут только значения
   *    диалогов (`items.map(i => i.dialog)`), они те же.
   */
  const announce = (ops: DialogOp[]) => { onDialogOps?.(ops) }
  /** Изменились ЗНАЧЕНИЯ кэша: разослать и запланировать запись на диск. */
  const publish = (ops: DialogOp[]) => { announce(ops); scheduleSave() }
  const draftFor = (chatId: number) => drafts.find((d) => d.chatId === chatId)

  /** Порядок — производная от данных (tweb generateDialogIndex, dialogs.ts:605-608). */
  const sort = (dialogs: Dialog[]): DialogItem[] =>
    dialogs
      .map((dialog) => ({ dialog, index: dialogIndex(dialog, pinnedOrder, draftFor(dialog.chatId)) }))
      .sort((a, b) => b.index - a.index)

  /**
   * Досеять `pinnedOrders` порядком закреплённых из получившегося списка — порт
   * tweb `generateDialogPinnedDate` (dialogs.ts:934-936), где отсутствующий в
   * порядке закреплённый тут же в него добавляется (`order.unshift`) и порядок
   * сохраняется (`savePinnedOrders`). До Task 6 жил в main (`chatsStore.
   * applyDialogs`/`syncPinnedOrder`) и не был перенесён вместе с остальным —
   * последний кусок легаси-пути, см. `stores/chatsStore.order.test.ts` (снесён
   * этой же задачей, сценарии перенесены сюда).
   *
   * Зачем: `pinned_at` сервер наружу не отдаёт (в `Dialog` только флаг
   * `pinned`), он выражен лишь ПОРЯДКОМ ответа `/chats` (ORDER BY m.pinned_at
   * DESC, chatsrepo.go:225). Первый применённый список этот порядок и
   * фиксирует (стабильная сортировка ES2019 разводит dialogIndex-«ничьи» между
   * ЕЩЁ не отслеженными закреплёнными строго по порядку входного массива —
   * см. докблок `dialogIndex.pinnedDate`), дальше он берётся из `pinnedOrder` —
   * иначе закреплённые без записи в порядке (все получают ОДИНАКОВЫЙ индекс)
   * зависели бы от порядка входного массива при КАЖДОМ применении, то есть от
   * того же расхождения кэш/сеть, ради которого dialogIndex вообще заведён.
   *
   * Тот же канал записи/зеркала, что `applyPinned` (Task 4) — второй писатель
   * `pinnedOrders` не заводится.
   *
   * Возвращает, действительно ли `pinnedOrder` изменился: до сих пор
   * НЕотслеженные закреплённые (`idx===-1` в `dialogIndex.pinnedDate`) все
   * получают ОДИНАКОВЫЙ индекс (offset считается от длины `pinnedOrder`, не от
   * позиции) — засеяв их позициями в `next`, тот же `dialogIndex()` для КАЖДОГО
   * из них начнёт отдавать РАЗНЫЕ значения. `setAll` обязан пересчитать `items`
   * заново в этом случае — иначе их СОХРАНЁННЫЙ `index` (ещё старый, общий)
   * разойдётся с тем, что `dialogIndex()` вернул бы сейчас, и ближайший же
   * `patchDialog` любого из них (например, входящее сообщение) пересчитает
   * его индекс уже НОВЫМ и заново засеянным `pinnedOrder`, увидит `moved` и
   * перетасует пин-блок, будто это первый вход в порядок — см.
   * `dialogsManager.test.ts`, «первичное засеивание переживает последующий
   * точечный patch, не только повторный полный список».
   */
  function syncPinnedOrder(sorted: readonly DialogItem[]): boolean {
    const next = sorted.filter((i) => i.dialog.pinned).map((i) => i.dialog.chatId)
    if (next.length === pinnedOrder.length && next.every((id, i) => id === pinnedOrder[i])) return false
    pinnedOrder = next
    pinnedOrders = { ...pinnedOrders, [ALL_FOLDER_ID]: next }
    void savePinnedOrders?.(pinnedOrders)
    mirrorStateKey?.('pinnedOrders', pinnedOrders)
    return true
  }

  /**
   * Совпал ли пересчитанный список с текущим — И порядком (`chatId` + `index`),
   * И значениями. `equal()` — тот же структурный компаратор, которым
   * `reconcileEntity` сохраняет ссылки на витрине.
   */
  function sameItems(a: readonly DialogItem[], b: readonly DialogItem[]): boolean {
    return a.length === b.length
      && a.every((it, i) => it.index === b[i].index && it.dialog.chatId === b[i].dialog.chatId && equal(it.dialog, b[i].dialog))
  }

  /**
   * Применить ПОЛНЫЙ список: кэш при гидрации, а при сетевом догоне — результат
   * слияния окна с кэшем (`mergeWindow`), а не сам ответ сети: подменять
   * коллекцию ответом нельзя (web-client/CLAUDE.md, «НЕЛЬЗЯ»).
   *
   * Fix (финальное ревью, Important #4): `null`, если результат структурно
   * совпал с текущим `items`, — вторая половина того же правила: «совпавший с
   * памятью ответ не даёт ни перерисовки, ни записи в IDB» (порт tweb
   * `saveDialogFilter`). Без этого каждый
   * колсайт `refresh()` (их больше десятка — Sidebar, deep-links, редактор
   * контакта, resync-кадр) публиковал бы `reset` и переписывал ВЕСЬ `S_DIALOGS`
   * даже когда сервер вернул ровно то же самое.
   *
   * Прежний `items` при совпадении сохраняется ПО ССЫЛКЕ (вместе со ссылками на
   * сами диалоги) — свежие объекты `mapDialog` выбрасываем: кэш владельца ведёт
   * себя так же, как зеркало под `reconcileById`.
   */
  const setAll = (dialogs: Dialog[]): DialogOp | null => {
    const prev = items
    items = sort(dialogs)
    // Пересортировать НАДО ЖЕ засеянным pinnedOrder — см. докблок syncPinnedOrder.
    if (syncPinnedOrder(items)) items = sort(dialogs)
    if (sameItems(prev, items)) { items = prev; return null }
    return { op: 'reset', items }
  }

  const findDialog = (chatId: number): Dialog | undefined => items.find((i) => i.dialog.chatId === chatId)?.dialog

  /**
   * Точечно смержить `fields` в один диалог кэша и опубликовать `patch`. Индекс
   * пересчитывается той же чистой `dialogIndex()` — если он не сдвинулся, `index`
   * в операции не участвует (зеркало просто накладывает `fields` на месте).
   *
   * Диалога нет в кэше — не ошибка (Task 3, «Осторожно» #3): молча выходим, как
   * раньше выходил `if (!cur) return {}` в chatsStore — он приедет со следующей
   * загрузкой/reset'ом.
   *
   * Fix (ревью Task 3, Important): смерженный результат структурно совпал с
   * текущим значением (напр. бэкенд повторно шлёт идентичный `chat_update` —
   * `publishChatUpdate` зовётся из 13 мест бэка и прилетает КАЖДОМУ участнику
   * чата) — `patch` не публикуем вовсе. Раньше (main, chatsStore.applyChatMeta)
   * это давало бесплатно `reconcileEntity`/`reconcileById` (совпавший ответ
   * возвращает ИСХОДНЫЙ объект/массив); patch-путь владельца эту сверку не
   * делал и создавал новую ссылку на диалог/патчил зеркало (`chatsStore.ts`,
   * ветка `patch`: `{...d, ...op.fields}` МИМО `reconcileById`) при нулевом
   * изменении данных — лишний ре-рендер мемоизированного `ChatListItem`.
   * `equal()` — тот же структурный компаратор, что и в `reconcileEntity`.
   */
  function patchDialog(chatId: number, fields: Partial<Dialog>): void {
    const idx = items.findIndex((i) => i.dialog.chatId === chatId)
    if (idx === -1) return
    const prev = items[idx].dialog
    const dialog: Dialog = { ...prev, ...fields }
    if (equal(prev, dialog)) return
    const index = dialogIndex(dialog, pinnedOrder, draftFor(chatId))
    const moved = index !== items[idx].index
    items[idx] = { dialog, index }
    if (moved) items = [...items].sort((a, b) => b.index - a.index)
    publish([{ op: 'patch', chatId, fields, ...(moved ? { index } : {}) }])
  }

  // Расшифровать превью секретных чатов «на месте» (мутирует lastMessage
  // входящих диалогов) — порт `chatsStore.decryptSecretPreviews` (main, до
  // Task 6), но без RPC: секретный ключ знает `secretManager`, живущий в этом
  // же воркере. Диалог без encBody, с уже готовым text или не secret-типа —
  // no-op; упавшая дешифровка (ключ ещё не пришёл/битый) глотается, превью
  // остаётся generic-лейблом — как и раньше.
  async function decryptSecretPreviews(dialogs: Dialog[]): Promise<void> {
    if (!decryptSecret) return
    await Promise.all(dialogs.map(async (d) => {
      const lm = d.lastMessage
      if (d.type !== 'secret' || !lm?.encBody || lm.text) return
      const dec = await decryptSecret(d.chatId, lm.encBody).catch(() => null)
      if (!dec) return
      lm.text = dec.text
      if (!dec.text && dec.media) lm.mediaType = dec.media.mediaType
    }))
  }

  async function doHydrate(): Promise<void> {
    // Гварды поколения (Minor #4): чтение диска асинхронно, за это время могла
    // случиться смена сессии — тогда прочитанное принадлежит прошлому аккаунту.
    // Выходим, НЕ выставив `hydrated`: следующий вызов гидрирует заново, уже
    // под новым скоупом персиста.
    const gen = sessionGen
    const state = await loadState()
    if (gen !== sessionGen) return
    pinnedOrders = state.pinnedOrders
    pinnedOrder = pinnedOrders[ALL_FOLDER_ID] ?? []
    drafts = state.drafts
    folders = state.folders ?? []
    if (!items.length) {
      const cached = await loadCache()
      await decryptSecretPreviews(cached)
      if (gen !== sessionGen) return
      setAll(cached)
    }
    hydrated = true
  }

  /**
   * Элементы кэша, прошедшие фильтр папки, в текущем порядке — порт tweb
   * `getFolderDialogs(filterId)` (dialogs.ts:1650). `null` — посчитать папку
   * ПОКА НЕЧЕМ; показать вместо неё весь список (или неверно отфильтрованный)
   * хуже, чем показать пустую страницу со скелетонами (спека, «Фильтр папки
   * переезжает в воркер»).
   *
   * Входов у фильтра два, и «ещё не приехало» бывает у обоих:
   *  - определения папок (`folders`) — папки с таким id мы не знаем;
   *  - контакты (`contactsKnown`) — правило `contacts`/`non_contacts` без них
   *    посчитало бы КАЖДЫЙ приватный чат не-контактом и молча отдало неверную
   *    страницу. tweb в этом месте дожидается `fillContacts()`
   *    (dialogs.ts:1625-1642); нам ждать нечего — контакты приходят пушем, —
   *    поэтому ведём себя как с неизвестной папкой.
   */
  function forFilter(filterId: number): DialogItem[] | null {
    if (filterId === ALL_FOLDER_ID) return items.filter((i) => !i.dialog.archived)
    if (filterId === ARCHIVE_FOLDER_ID) return items.filter((i) => i.dialog.archived)
    const folder = folders.find((f) => f.id === filterId)
    if (!folder) return null
    if (!contactsKnown && (folder.contacts || folder.nonContacts)) return null
    // Архив в пользовательские папки не попадает — как в tweb, где архивные
    // диалоги лежат в ДРУГОЙ реальной папке и в выборку фильтра не входят.
    return items.filter((i) => !i.dialog.archived && dialogMatchesFolder(i.dialog, folder, contactIds))
  }

  /**
   * Элементы ВЫБОРКИ (а не папки) в текущем порядке: для `all`/`archive` это и
   * есть отфильтрованный список, для пользовательской папки — ВЕСЬ кэш, потому
   * что её выборка глобальная (tweb: `realFolderId` = GLOBAL для фильтра,
   * dialogs.ts:1646-1649).
   *
   * Заведён отдельно от `forFilter`, чтобы у сетевой страницы всё, что зависит
   * от выборки, считалось по ОДНОМУ списку: и курсор (`offset_chat_id`), и
   * размер удерживаемого окна (`held`, размер фолбэка залипшего курсора). Пока
   * курсор брался из выборки, а размер окна — из отфильтрованной папки,
   * фолбэк для пользовательской папки просил ЗАВЕДОМО КОРОТКУЮ страницу
   * (длина папки вместо длины кэша) и курсор не расклинивал: страница вновь
   * приносила уже известное, `added` оставался нулём, и список папки замирал
   * на плейсхолдерах.
   */
  const scopeList = (filterId: number): DialogItem[] =>
    scopeFor(filterId) === 'global' ? items : (forFilter(filterId) ?? [])

  /**
   * Размер набора для страницы — порт `count: loadedAll ? curDialogStorage.length
   * : this.getFolder(filterId).count` (dialogs.ts:1706).
   *
   * Выборка загружена целиком — размер это длина кэша. Иначе берём серверный
   * `count` СВОЕЙ выборки, а если её сеть ещё не видела — глобальный: это
   * ЗАВЫШЕННАЯ оценка, и она здесь не компромисс, а механизм. Размер набора
   * рождает дырку в виртуальном списке, дырка дёргает `requestItemForIdx`, и
   * только он запускает догрузку; равный длине кэша размер дырок не даёт
   * никогда, и список не наполняется вовсе. Пользовательская папка живёт на
   * этой оценке постоянно — ровно как в оригинале, где `folder.count` фильтра
   * присваивается из ответа по ГЛОБАЛЬНОЙ папке (dialogs.ts:1728).
   */
  function countFor(filterId: number, cached: readonly DialogItem[]): number {
    const scope = scopeFor(filterId)
    if (isLoaded(scope)) return cached.length
    return serverCount[scope] ?? serverCount.global ?? cached.length
  }

  /**
   * Позиция курсора в отфильтрованном списке — порт dialogs.ts:1691-1698.
   * Курсор — ЗНАЧЕНИЕ индекса последнего полученного диалога, а не позиция:
   * список мог переехать между запросами, линейный поиск это переживает.
   */
  function offsetFor(list: readonly DialogItem[], offsetIndex: number): number {
    let offset = 0
    if (offsetIndex > 0) {
      for (const length = list.length; offset < length; ++offset) {
        if (offsetIndex > list[offset].index) break
      }
    }
    return offset
  }

  /**
   * Слить страницу в кэш: новые диалоги дописываются, известные обновляются на
   * месте, публикуется `upsert` (`reset` остаётся за `refresh()` и гидрацией).
   *
   * `syncPinnedOrder` здесь НЕ зовётся сознательно (спека, «Хвост из этапа 1»):
   * порядок закреплённых выводится из ПОЛНОГО списка, а частичная страница
   * видит лишь часть пинов — засеяв порядок по ней, мы поставили бы ещё не
   * приехавшие закреплённые задним числом ниже. Дублирующая проверка — тест
   * «слияние страницы не трогает порядок закреплённых»
   * (dialogsManager.pagination.test.ts).
   *
   * Возвращает, сколько диалогов страница добавила ВПЕРВЫЕ (обновление уже
   * известного не считается). Ноль — признак того, что курсор не продвинулся;
   * что с этим делать, решает `getDialogs` (см. там фолбэк залипшего курсора —
   * повторная страница БЕЗ курсора).
   */
  function mergePage(dialogs: Dialog[]): number {
    const byId = new Map(items.map((i) => [i.dialog.chatId, i]))
    const changed: DialogItem[] = []
    let added = 0
    for (const dialog of dialogs) {
      const prev = byId.get(dialog.chatId)?.dialog
      if (!prev) added++
      else if (equal(prev, dialog)) continue // тот же диалог теми же значениями — не операция
      const item: DialogItem = { dialog, index: dialogIndex(dialog, pinnedOrder, draftFor(dialog.chatId)) }
      byId.set(dialog.chatId, item)
      changed.push(item)
    }
    if (!changed.length) return added
    items = [...byId.values()].sort((a, b) => b.index - a.index)
    publish([{ op: 'upsert', items: changed }])
    return added
  }

  /**
   * Время последнего сообщения диалога в миллисекундах — ключ СЕРВЕРНОГО
   * порядка (`ORDER BY m.pinned_at DESC NULLS LAST, lm.created_at DESC NULLS
   * LAST, c.id DESC`, chatsrepo.go:229), а не наш `dialogIndex`: последний
   * поднимает диалог черновиком (`dialogIndex.activityDate`), которого сервер
   * не видит. Всё, что сверяется с порядком ОТВЕТА, обязано считаться этим
   * ключом. `0` — сообщений нет (пустой чат либо очищенная история).
   */
  const msgTime = (d: Dialog): number => {
    const ms = Date.parse(d.lastMessage?.at ?? '')
    return Number.isNaN(ms) ? 0 : ms
  }

  /**
   * Диалоги ВРЕМЕННОГО ПОТОКА выборки — те, чьё место в серверном порядке
   * задано временем последнего сообщения. Порт гварда `if(offsetDate &&
   * !dialog.pFlags.pinned)` (dialogs.ts:1051): и закреплённые, и диалоги без
   * сообщения из потока выпадают, и оригинал не пускает их ни в смещение
   * пагинации, ни в рассуждения о том, что этим смещением накрыто.
   *
   * У нас это тем важнее, что порядок сервера — `pinned_at DESC NULLS LAST,
   * lm.created_at DESC NULLS LAST` (chatsrepo.go:229): страница НЕ является
   * непрерывным временным отрезком. Закреплённый идёт первым с любым (в том
   * числе древним или отсутствующим) последним сообщением, а очищенные чаты
   * `NULLS LAST` уводит в самый хвост.
   */
  const inFlow = (d: Dialog): boolean => !d.pinned && msgTime(d) > 0
  const flowOf = (page: readonly Dialog[]): Dialog[] => page.filter(inFlow)

  /**
   * Продвинуть курсор выборки последним диалогом её страницы — и только ВГЛУБЬ
   * (порт `if(!savedOffsetDate || offsetDate < savedOffsetDate)`,
   * dialogs.ts:1060-1066). Пустой ответ курсор не двигает: двигать его в ноль
   * значило бы перечерпывать выборку с начала (порт `if(offsetDate && ...)`,
   * dialogs.ts:1051).
   *
   * Опорным берётся последний диалог ПОТОКА, а не страницы: закреплённый
   * приехал бы курсором наверх набора (сервер ставит его первым при любом
   * времени), а диалог без сообщения дал бы `at === 0` — правило «только
   * вглубь» после такого не выполнилось бы уже никогда, и выборка застряла бы
   * на одном и том же `offset_chat_id`.
   */
  function advanceCursor(scope: Scope, page: readonly Dialog[]): void {
    const flow = flowOf(page)
    const last = flow[flow.length - 1]
    if (!last) return
    const at = msgTime(last)
    const saved = serverCursor[scope]
    if (!saved || at < saved.at) serverCursor[scope] = { chatId: last.chatId, at }
  }

  /**
   * Сетевая страница — порт `appMessagesManager.getTopMessages` из ветки
   * догрузки (dialogs.ts:1712-1717). Курсор к серверу — `chatId` последнего
   * элемента ТОЙ ЖЕ выборки, а не `offsetIndex`: у бэкенда своего понятия
   * `dialogIndex` нет (отступление №1 спеки этапа 2), а чат из другой папки он
   * внутри выборки не нашёл бы и отдал страницу с начала (`dialogpage.go`).
   *
   * `useCursor === false` — страница НАМЕРЕННО без курсора (фолбэк залипшего
   * курсора, см. `getDialogs`). `null` — ответ применять нельзя (офлайн либо
   * сменившаяся сессия).
   */
  async function fetchPage(filterId: number, limit: number, useCursor = true): Promise<{ isEnd: boolean; added: number } | null> {
    const gen = sessionGen
    const scope = scopeFor(filterId)
    // Курсор — докуда дочерпала пагинация СВОЕЙ выборки (`serverCursor`); пока
    // её страниц не было, отталкиваемся от хвоста того, что держим, — это кэш
    // прошлой сессии с диска, поднятый гидрацией (для пользовательской папки
    // хвост берётся по всему кэшу, см. докблок `scopeList`).
    //
    // Опорный чат обязан ЛЕЖАТЬ в кэше выборки: `chat_id`, которого мы больше
    // не держим (диалог выпал при слиянии окна, ушёл в архив, был удалён),
    // просит у сервера продолжение с места, которого у нас нет, — голова
    // выборки осталась бы дырками, а каждая следующая страница уходила бы
    // глубже. Такой курсор — некорректное состояние, а не повод для фолбэка:
    // фолбэк залипшего курсора (`getDialogs`) ловит другое, `added === 0`.
    const cursorList = scopeList(filterId)
    const heldTail = cursorList.length ? cursorList[cursorList.length - 1].dialog.chatId : 0
    const saved = serverCursor[scope]
    const held = saved !== null && cursorList.some((i) => i.dialog.chatId === saved.chatId)
    const offsetChatId = useCursor ? (held ? saved.chatId : heldTail) : 0
    const wire = WIRE_FOLDER[scope]
    const query: Record<string, string | number> = { limit, offset_chat_id: offsetChatId }
    if (wire !== undefined) query.folder_id = wire
    try {
      const r = await rest.get<ChatsResponse>('/chats', query)
      const dialogs = (r.chats ?? []).map(mapDialog)
      await decryptSecretPreviews(dialogs)
      // Ответ отправлен под ПРОШЛЫМ токеном (Minor #4) — не применяем.
      if (gen !== sessionGen) return null
      if (typeof r.count === 'number') serverCount[scope] = r.count
      advanceCursor(scope, dialogs)
      const isEnd = !!r.is_end
      const added = mergePage(dialogs)
      // Полной выборка считается, когда конец ДОСТИГНУТ и мы держим её
      // ЦЕЛИКОМ: либо страница шла без курсора (значит покрыла выборку от
      // начала), либо кэш выборки дорос до серверного `count`. Порт tweb: там
      // `dialogsLoaded` поднимает любая дошедшая до конца страница
      // (appMessagesManager.ts:3639), потому что страницы идут строго сверху;
      // у нас курсор — `chatId`, и при исчезнувшем опорном чате бэкенд отдаёт
      // с начала (`dialogpage.go`), поэтому одного `is_end` мало — сверяем с
      // размером выборки, как это же делает tweb в `dialogsLength >= count`.
      // `scopeList` здесь пересчитывается сознательно: страница только что
      // влилась в кэш (`mergePage` выше), и удерживаемое окно уже ДРУГОЕ, не то,
      // из которого брался курсор. Короткое замыкание бережёт лишний проход по
      // кэшу: без `is_end` и без курсора размер выборки не нужен вовсе.
      if (isEnd && (!offsetChatId || scopeList(filterId).length >= (serverCount[scope] ?? Infinity))) setLoaded(scope)
      return { isEnd, added }
    } catch (e) {
      if (e instanceof HttpError) throw e
      return null // офлайн — остаёмся на кэше, как в refresh()
    }
  }

  /**
   * Свести окно глобальной выборки с кэшем и вернуть список, который должен
   * получиться. Полной подменой применять ответ НЕЛЬЗЯ (web-client/CLAUDE.md,
   * «НЕЛЬЗЯ»: «Применять ответ сети полной подменой коллекции»; порт tweb
   * `saveDialogs` — там ответ всегда сливается, а не заменяет набор): пока
   * `refresh()` был безлимитным, «окно» и «весь список» совпадали и разницы не
   * было, а страничное окно выкидывало бы всё, что лежит ниже него, — архив
   * (`ArchiveList` тут же подменялся бы заглушкой и терял `scrollTop`) и
   * глубокие страницы пользовательских папок.
   *
   * При этом `refresh()` — ещё и ремонт списка после разрыва потока апдейтов
   * (`rt:resync`, `client/realtime/refetchSubscriber.ts`): удаления приезжают
   * своим каналом (`chat_removed` → `applyRemoved`, плюс прямой вызов после
   * успеха REST-действия), но кадр, потерянный в разрыве, к нам уже не придёт —
   * ремонт может быть только сверкой с ответом. Поэтому из кэша снимается РОВНО
   * то, что сервер точно не вернул, хотя обязан был бы: диалог, попадающий во
   * ВРЕМЕННОЙ ДИАПАЗОН окна (между самым свежим и самым старым его сообщением),
   * но отсутствующий в ответе. Всё, что ниже окна, не трогается — оно вне
   * зоны ответственности этого ответа.
   *
   * Границы считаются ТОЛЬКО по временному потоку окна (`flowOf`), и сверяются
   * с ним же — пять категорий диалогов ведут себя по-разному; первые четыре —
   * осознанно, пятая это известная цена (см. её пункт):
   *  - **закреплённый** в границы не входит и правилом не снимается: сервер
   *    ставит его первым при любом времени последнего сообщения (в том числе
   *    древнем), поэтому по времени он окно не описывает — считая по нему,
   *    нижняя граница проваливалась бы к нему, и всё удерживаемое ниже
   *    (глубокие страницы папок, набранный прокруткой архив) снималось бы как
   *    «пропавшее внутри окна»;
   *  - **без последнего сообщения** (пустой чат, очищенная история —
   *    `cleared_max_seq`, chatsrepo.go:213) — то же самое, только границу он
   *    обнулял бы совсем, и слияние выродилось бы обратно в полную подмену;
   *  - **с временем РОВНО на нижней границе** — остаётся: тайбрейк сервера
   *    `c.id DESC` (chatsrepo.go:229) может отрезать соседа с той же меткой
   *    сразу за срезом страницы, и его отсутствие в ответе ничего не доказывает;
   *  - **поднявшийся выше всего окна** (realtime-сообщение долетело до нас
   *    раньше, чем сервер собрал ответ) — остаётся: вернуть его сервер не мог,
   *    это мы знаем больше, чем он;
   *  - **с УДАЛЁННЫМ на сервере последним сообщением** — единственная категория,
   *    которую правило снимает ошибочно, и это принятая цена. Нашу копию
   *    `lastMessage` вниз никто не пересчитывает (её единственный писатель —
   *    `applyNewMessage`), поэтому чат, уехавший на сервере НИЖЕ окна из-за
   *    удаления своих последних сообщений, в ответе не придёт, а локальный
   *    `msgTime` останется внутри `(bottom, top]` — строка снимется из кэша и
   *    пропадёт из сайдбара до ближайшей догрузки вглубь, которая вернёт её с
   *    верным временем. Данные не теряются, поэтому гвард («снимать, только
   *    если сервер подтвердил чат временем ниже нашего» — то есть второй проход
   *    сверки и второй источник правды о времени) дороже, чем сама цена.
   *
   * Цена решения: фантом закреплённого или очищенного диалога, чей
   * `chat_removed` потерялся в разрыве потока апдейтов, этим ответом НЕ
   * снимается — его снимет свой канал (`applyRemoved`) либо ответ с `is_end`,
   * когда выборка целиком уместится в окно. Ложное удаление живого диалога
   * дороже задержавшегося фантома.
   *
   * Сравнение — по `msgTime` (ключ серверного порядка), а не по `dialogIndex`:
   * иначе диалог, поднятый ЛОКАЛЬНЫМ черновиком, попадал бы в окно, которого
   * сервер для него не строил.
   */
  function mergeWindow(page: Dialog[], isEnd: boolean): Dialog[] {
    const held = items.map((i) => i.dialog)
    // Окно накрыло выборку ОТ НАЧАЛА И ДО КОНЦА — оно и есть весь список.
    if (isEnd) return page
    // Пустое окно без `is_end` — сервер не сказал ничего, сверять не с чем.
    if (!page.length) return held
    const returned = new Set(page.map((d) => d.chatId))
    const flow = flowOf(page)
    // В окне ни одного диалога временного потока (только закреплённые и/или
    // очищенные) — границ нет, сверять не с чем: просто сливаем.
    if (!flow.length) return [...page, ...held.filter((d) => !returned.has(d.chatId))]
    let top = -Infinity
    let bottom = Infinity
    for (const d of flow) {
      const t = msgTime(d)
      if (t > top) top = t
      if (t < bottom) bottom = t
    }
    const kept = held.filter((d) => {
      if (returned.has(d.chatId)) return false // свежая версия уже в `page`
      if (!inFlow(d)) return true // вне временного потока — правилом не снимаем
      const t = msgTime(d)
      return t <= bottom || t > top
    })
    return [...page, ...kept]
  }

  /**
   * Тело `refresh()` отдельной функцией, а не методом объекта. До Task 4 его
   * звал и `getDialogs` — фолбэком залипшего курсора; теперь фолбэк там свой
   * (страница БЕЗ курсора, см. `getDialogs`), и внутренних потребителей у тела
   * не осталось. Форма сохранена: ссылаться из объекта на его собственный
   * метод (`this`/замыкание на литерал) владелец не может — он раздаётся по
   * RPC поштучно, `this` на той стороне не существует, поэтому любой будущий
   * внутренний колсайт упёрся бы ровно в это.
   *
   * Перечитывает РОВНО удерживаемое окно, а не весь список. Три следствия, и
   * все три — цель правки (спека, «`refresh()` тянет весь список»):
   *  - холодный старт держит ноль, значит просит одну страницу: `boot.ts`
   *    становится страничным сам по себе, без правок в нём;
   *  - все девятнадцать колсайтов остаются верными — они получают свежий вид
   *    того же окна, а всё, что лежит ниже него (архив, глубокие страницы
   *    папок), переживает ответ: окно СЛИВАЕТСЯ с кэшем, см. `mergeWindow`;
   *  - `loadedAll` поднимается только по `is_end`, то есть когда окно
   *    действительно накрыло набор, — раньше безлимитный запрос поднимал его
   *    ВСЕГДА и глушил догрузку до конца сеанса.
   *
   * Выборка — глобальная: `refresh()` обслуживает кэш целиком, а не папку.
   */
  async function doRefresh(): Promise<DialogOp | null> {
    const gen = sessionGen
    await hydrate()
    const limit = Math.max(items.length, DIALOG_LOAD_COUNT)
    try {
      const r = await rest.get<ChatsResponse>('/chats', { limit })
      const dialogs = (r.chats ?? []).map(mapDialog)
      await decryptSecretPreviews(dialogs)
      // Ответ отправлен под ПРОШЛЫМ токеном (Minor #4) — не применяем.
      if (gen !== sessionGen) return null
      if (typeof r.count === 'number') serverCount.global = r.count
      // Окно прочитано ОТ НАЧАЛА глобальной выборки, значит её пагинация дошла
      // как минимум до последнего диалога ответа (см. докблок `serverCursor`):
      // без этого следующая страница папки пошла бы от хвоста кэша, куда
      // страница архива уже положила самый старый архивный диалог.
      advanceCursor('global', dialogs)
      // Запрос идёт БЕЗ курсора, поэтому `is_end` означает «окно накрыло набор
      // от начала», то есть кэш держит его целиком.
      if (r.is_end) setLoaded('global')
      const op = setAll(mergeWindow(dialogs, !!r.is_end))
      // Ответ совпал с памятью — ни операции, ни записи на диск (Important #4).
      if (op) publish([op])
      return op
    } catch (e) {
      if (e instanceof HttpError) throw e
      return null
    }
  }

  function hydrate(): Promise<void> {
    if (hydrated) return Promise.resolve()
    // `hydrating === p` в finally (а не безусловное обнуление): `resetForLogout()`
    // сбрасывает `hydrating` синхронно, и гидратация ПРОШЛОЙ сессии, дорезолвившись
    // позже, обнулила бы ссылку на уже начатую гидратацию НОВОЙ — третий
    // конкурентный вызов начал бы её заново (тот же класс гонки, что закрыт
    // кэшированием промиса вместо булева флага, см. докблок `hydrating`).
    const p = (hydrating ??= doHydrate().finally(() => { if (hydrating === p) hydrating = null }))
    return p
  }

  return {
    /**
     * Зеркало объявило пробел. Отвечаем ВСЕГДА — и ответом RPC (его ждёт boot.ts
     * до первого рендера), и веером (соседние вкладки). «Уже публиковали» не
     * считается доставкой: SuperMessagePort кадры не буферизует.
     *
     * `announce`, а не `publish` (Important #4, отложенная мелочь): значения
     * только что прочитаны с диска — планировать обратную запись на тот же диск
     * бессмысленно.
     */
    async fillMirror(): Promise<DialogOp> {
      const gen = sessionGen
      await hydrate()
      // Сессия сменилась, пока читали диск (Minor #4): ответ прошлого аккаунта
      // ни рассылать, ни отдавать спросившему нельзя — отдаём честно пустой.
      if (gen !== sessionGen) return { op: 'reset', items: [] }
      const op: DialogOp = { op: 'reset', items }
      announce([op])
      return op
    },

    /**
     * Сетевой догон. Офлайн — молча остаёмся на кэше (как прежний listDialogs).
     *
     * Fix (финальное ревью, Important #2): возвращает ОПУБЛИКОВАННУЮ операцию
     * (или `null`, если применять нечего). Единственным каналом доставки был
     * бродкаст `rt:dialog_op`, а насос `smp.on(...)` поднимается лишь в
     * `startRealtime()` из эффекта `useAppBootstrap` — ПОСЛЕ первого рендера;
     * `SuperMessagePort` кадры не буферизует, поэтому ответ `/chats`, пришедший
     * раньше подписки (localhost/быстрая сеть — обычное дело), уходил в никуда,
     * и вкладка жила весь сеанс на дисковом кэше. Правило то же, что у
     * `fillMirror`: пробел закрывает ОТВЕТ RPC, а не следующий бродкаст;
     * повторное применение через бродкаст идемпотентно.
     */
    refresh: doRefresh,

    getSnapshot: (): DialogItem[] => items,

    /**
     * Страница списка — порт tweb `dialogsStorage.getDialogs`
     * (lib/storages/dialogs.ts:1691-1753; поиск/форумы/`skipMigrated` у нас
     * отсутствуют как явления, поэтому портирована только ветка списка).
     *
     * Три шага оригинала: (1) отфильтровать кэш папкой, (2) найти курсор
     * линейным поиском по ЗНАЧЕНИЮ индекса, (3) хватает кэша — нарезать
     * локально, не хватает — одна сетевая страница, пересчитать курсор,
     * нарезать заново.
     *
     * Размер набора и признак конца — `countFor`/`isLoaded` (см. их докблоки);
     * страница, не дотянувшаяся до хвоста кэша, концом не считается — порт
     * `dialogs.ts:1751`.
     *
     * Конкурентные вызовы НЕ сериализуются: два одновременных `getDialogs`
     * выпустят два запроса. Так же и в tweb — очередь держит потребитель
     * (`helpers/sequentialCursorFetcher.ts`, этап 3), а не хранилище.
     */
    async getDialogs(options: { offsetIndex?: number; limit?: number; filterId?: number } = {}): Promise<DialogsPage> {
      const { offsetIndex = 0, limit = DEFAULT_LIMIT, filterId = ALL_FOLDER_ID } = options
      const gen = sessionGen
      await hydrate()
      // Сессия сменилась, пока читали диск (Minor #4) — отдаём честно пустую страницу.
      if (gen !== sessionGen) return { dialogs: [], count: 0, isEnd: false }

      const cached = forFilter(filterId)
      // Считать папку пока нечем (определения или контакты не приехали) — см. forFilter.
      if (!cached) return { dialogs: [], count: 0, isEnd: false }

      // Порт dialogs.ts:1700-1710 — попадание в кэш отвечает без сети.
      const offset = offsetFor(cached, offsetIndex)
      const isEnoughDialogs = cached.length >= offset + limit
      const loaded = isLoaded(scopeFor(filterId))
      if (loaded || isEnoughDialogs) {
        return {
          dialogs: cached.slice(offset, offset + limit).map((i) => i.dialog),
          count: countFor(filterId, cached),
          isEnd: loaded && offset + limit >= cached.length,
        }
      }

      // Порт dialogs.ts:1712-1752 — одна страница из сети, затем пересчёт курсора.
      let res = await fetchPage(filterId, limit)
      // Гварды сессии здесь и в ветке фолбэка ниже СОЗНАТЕЛЬНО НЕ ПОКРЫТЫ
      // мутацией (довод один на оба): `resetForLogout()`
      // синхронно опустошает `items`, а `fetchPage` под сменившимся поколением
      // ничего не сливает, поэтому нижняя ветка и так соберёт пустую страницу —
      // обе ветки дают один результат. Гвард держит инвариант «ответ прошлой
      // сессии не собирается из кэша НОВОЙ» (регидратация могла успеть
      // наполнить `items` между сбросом и этой строкой) и обязан пережить
      // появление такой регидратации.
      if (gen !== sessionGen) return { dialogs: [], count: 0, isEnd: false }
      // Страница по курсору не принесла НИ ОДНОГО нового диалога и концом
      // выборки себя не объявила — курсор залип: опорный чат на сервере исчез,
      // и бэкенд отдаёт с начала (`dialogpage.go`), а хвост кэша не сдвинулся,
      // значит следующий запрос уйдёт с ТЕМ ЖЕ `offset_chat_id` — список не
      // продвинулся бы никогда. Выход — одна страница БЕЗ курсора, заведомо
      // накрывающая удерживаемое окно целиком: она и пересобирает голову, и
      // приносит хвост. Полным `refresh()` это лечить больше нельзя — он
      // ограничен тем же удерживаемым окном (Task 5) и списка не продвигает.
      if (res && !res.isEnd && !res.added) {
        // Размер фолбэка считается по ТОМУ ЖЕ списку, из которого брался курсор
        // (`scopeList`), а НЕ по отфильтрованной папке: у пользовательской папки
        // курсор — хвост всего кэша, и страница длиной с папку заведомо не
        // дотянулась бы до него — курсор остался бы залипшим (ревью Task 4,
        // Important 1).
        res = await fetchPage(filterId, scopeList(filterId).length + limit, false)
        // Тот же сознательно непокрытый гвард, что выше, — довод там же.
        if (gen !== sessionGen) return { dialogs: [], count: 0, isEnd: false }
      }
      const after = forFilter(filterId) ?? []
      const nextOffset = offsetFor(after, offsetIndex)
      const page = after.slice(nextOffset, nextOffset + limit)
      return {
        dialogs: page.map((i) => i.dialog),
        count: countFor(filterId, after),
        // `isLoaded` спрашивается ВТОРОЙ раз намеренно (первый — до `fetchPage`,
        // `loaded` выше): страница могла принести `is_end` и поднять флаг своей
        // выборки прямо сейчас, и тогда конец набора решает уже он, а не снимок,
        // сделанный до запроса.
        isEnd: (isLoaded(scopeFor(filterId)) && nextOffset + limit >= after.length)
          // tweb: `result.isEnd && curDialogStorage[len-1] === dialogs[len-1]`
          // (dialogs.ts:1751) — конец набора засчитан, только если окно
          // дотянулось до ХВОСТА кэша: страница короче хвоста концом списка не
          // является. Пустая страница при `isEnd` — тот же конец (дальше нечего).
          || (!!res?.isEnd && (page.length === 0 || page[page.length - 1] === after[after.length - 1])),
      }
    },

    /**
     * Контакты для правил папок `contacts`/`non_contacts`. Зовётся оттуда же,
     * откуда наполняется UI-стор (`stores/foldersStore.ts::loadFolders` →
     * `setContacts`): один источник, два потребителя — отдельного владения
     * контактами этап не заводит (спека, «Фильтр папки переезжает в воркер»).
     */
    setContactIds(ids: number[]): void {
      contactIds = new Set(ids)
      // Пустой список контактов — тоже ЗНАНИЕ (см. contactsKnown): до этого
      // вызова папка с правилом contacts/non_contacts честно отдаёт пустую
      // страницу, а не молча неверную.
      contactsKnown = true
    },

    /**
     * Task 5, «Осторожно» (смена аккаунта/логаут): гасит ОЖИДАЮЩИЙ таймер
     * (см. scheduleSave), пока он ещё не выстрелил, — экономит заведомо
     * бессмысленную запись устаревших диалогов (действие, чей REST-ответ
     * прилетел уже после логаута, успело бы запланировать саму запись, но не
     * успело её исполнить). Зовётся из workerCore.ts (onLoggingOut/
     * onLoggedIn) тем же приёмом, что `media.resetToken`/`resetDownloads` —
     * синхронно, ДО broadcast намерения перехода.
     *
     * Важно НЕ приписывать этому методу защиту от гонки «таймер уже
     * выстрелил, `saveDialogs()` в полёте (после `await locked()`, уже внутри
     * `enqueue()`), и тут приходит `persistClearAll()`» — от неё
     * `cancelPersist()` не защищает и защищать не должен: к этому моменту
     * отменять уже нечего. Гарантию даёт СУЩЕСТВУЮЩИЙ (до Task 5) механизм
     * `core/store/persist.ts`: `persistClearAll()` физически недостижим из
     * воркера иначе как через два кросс-контекстных RPC-раунда (воркер →
     * `broadcast(RT.loggingOut)` → main `useAuthGate.ts` →
     * `managers.persist.clearAll()` обратно в воркер) — на порядки медленнее
     * пары микротасков внутри самого воркера; а `enqueue()` того же стора
     * (`persist.ts`) батчит операции и открывает IndexedDB-транзакции В
     * ПОРЯДКЕ ВЫЗОВА, а IndexedDB исполняет readwrite-транзакции одного стора
     * в порядке их СОЗДАНИЯ, а не завершения (порядок фиксирует и комментарий
     * у `persistManager.clearAll`: «clear сериализуется после любых
     * накопленных воркером записей», актуален с до-Task-5 времён). Поэтому
     * `enqueue()` клира физически не может опередить уже вызванный `enqueue()`
     * записи диалогов — клир гарантированно ляжет ПОСЛЕ устаревшей записи, и
     * `cancelPersist()` тут ни при чём.
     *
     * Полный сброс самого кэша (`items`/`hydrated`) на логаут — `resetForLogout()`
     * ниже, отдельный метод (Task 6).
     */
    cancelPersist(): void {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    },

    /**
     * Task 6 (пины владения, приоритетная находка ревью Task 5): полный сброс
     * in-memory кэша владельца на логауте/смене аккаунта. `dialogsManager`
     * живёт в SharedWorker, который переживает `location.reload()` отдельной
     * вкладки, пока жива хотя бы одна другая, — без этого сброса `items`/
     * `hydrated` пережили бы логаут, и следующий `fillMirror()` (уже под ДРУГИМ
     * вошедшим пользователем) отдал бы готовый `items` вместо честной
     * регидратации с диска нового аккаунта — чужой список диалогов на экране.
     *
     * `items = []` обязателен, а не только `hydrated = false`: `doHydrate()`
     * перечитывает кэш с диска ТОЛЬКО когда `!items.length` (см. выше) — при
     * непустом `items` он молча оставил бы старые данные, даже сбросив флаг.
     * `pinnedOrders`/`pinnedOrder`/`drafts` тоже перезапишет ближайший
     * `doHydrate()` (он их читает безусловно), но обнуляем и здесь — с момента
     * `resetForLogout()` до следующего `fillMirror()`/`refresh()` кэш обязан
     * быть честно пуст, а не хранить обрывки прошлой сессии на случай, если
     * что-то дёрнет владельца в этом окне (напр. запоздавший realtime-кадр).
     *
     * Вызывается РЯДОМ с `cancelPersist()` — тем же приёмом, что
     * `media.resetToken()`/`resetDownloads()` (workerCore.ts, onLoggingOut/
     * onLoggedIn): каждый владелец сбрасывает СВОЙ кэш сам, отдельным вызовом.
     */
    resetForLogout(): void {
      // Minor #4: всё, что уже улетело под прошлым токеном (чтение диска в
      // doHydrate, ответ /chats в refresh), обязано осечься перед применением —
      // см. докблок sessionGen.
      sessionGen++
      items = []
      pinnedOrders = {}
      pinnedOrder = []
      drafts = []
      // Этап 2: папки и признаки загруженности — тоже про ПРОШЛЫЙ аккаунт.
      // `dialogsLoaded` пережил бы логаут и заставил `getDialogs` нового
      // пользователя отвечать «всё уже загружено» из пустого кэша, не сходив в
      // сеть; `folders`/`contactIds` дали бы чужие правила фильтрации.
      folders = []
      contactIds = new Set()
      contactsKnown = false
      dialogsLoaded.all = false
      dialogsLoaded.archive = false
      serverCount.global = serverCount.all = serverCount.archive = null
      // Курсоры пагинации — тоже про ПРОШЛЫЙ аккаунт: `chatId` чужих чатов
      // бэкенд в выборке нового не найдёт и отдаст страницу с начала (то есть
      // молча, но неверно), а первая же страница нового пользователя обязана
      // идти от начала явно.
      serverCursor.global = serverCursor.all = serverCursor.archive = null
      hydrated = false
      hydrating = null
    },

    /**
     * Ключ State, от которого зависит порядок, изменился (пишет persistManager).
     * Значения диалогов те же — публикуем reindex, а не reset.
     *
     * И по той же причине — `announce`, а не `publish` (Important #4): на диск
     * (`S_DIALOGS`) уезжают только значения диалогов, а они не изменились;
     * новый порядок целиком выводится из State-ключей, у которых свой писатель.
     */
    setStateKey(key: string, value: unknown): void {
      // Этап 2: определения папок — тот же канал, что pinnedOrders/drafts
      // (persistManager.stateKey → сюда). Порядок от них НЕ зависит, поэтому
      // ни пересортировки, ни reindex — только фильтр `getDialogs({filterId})`.
      if (key === 'folders') { folders = value as Folder[]; return }
      if (key === 'pinnedOrders') {
        pinnedOrders = value as Record<number, number[]>
        pinnedOrder = pinnedOrders[ALL_FOLDER_ID] ?? []
      } else if (key === 'drafts') drafts = value as Draft[]
      else return
      items = sort(items.map((i) => i.dialog))
      announce([{ op: 'reindex', items: items.map((i) => ({ chatId: i.dialog.chatId, index: i.index })) }])
    },

    // ── Task 3: realtime-кадры применяет владелец ────────────────────────────
    // Тела перенесены из chatsStore КАК ЕСТЬ (fallback `unread ?? +1`,
    // идемпотентность `applyRead`, абсолютный снимок `chat_update`); меняется
    // только выход — вместо `set({dialogs})` публикуем `patch`/`remove`.

    /** Новое сообщение (live `new_message`) поднимает диалог и бампит превью/unread. */
    applyNewMessage(e: NewMessageEvt): void {
      const cur = findDialog(e.chat_id)
      if (!cur) return // unknown chat (приедет на следующей reset-загрузке)
      const meId = getMeId?.() ?? null
      // Wave 3: сервер шлёт авторитетный unread получателям — берём verbatim; локальный
      // +1 остаётся fallback (старый бэк без поля). Своё же эхо (sender_id===meId,
      // включая другие вкладки/устройства) бейдж не бампит — у отправителя поле
      // `unread` в кадре и не приходит (backend message.go: `if uid != in.SenderID`).
      //
      // Отступление от прежнего main-кода (chatsStore.applyNewMessage): там ещё
      // проверялся `activeChatId`, чтобы не бампить бейдж для открытого на ЭТОЙ
      // вкладке чата. Воркер общий на все вкладки и какая из них что смотрит —
      // не знает; `activeChatId` — эфемерика, остаётся на main (докблок
      // ChatsState.activeChatId, спека docs/superpowers/specs/2026-08-12-
      // dialogs-ownership-and-virtual-list-design.md, «Что остаётся на main»).
      // Блип бейджа для открытого чата гасит немедленный markRead активной вкладки.
      const incoming = e.sender_id !== meId
      const nextUnread = incoming ? (e.unread ?? cur.unread + 1) : cur.unread
      patchDialog(e.chat_id, {
        lastMessage: {
          seq: e.seq,
          text: e.text,
          senderId: e.sender_id,
          at: e.created_at,
          mediaId: e.media_id ?? undefined,
          mediaType: e.type || undefined,
          senderName: e.sender_name || undefined,
          forwarded: e.fwd_from_user_id != null || e.fwd_from_chat_id != null || undefined,
        },
        unread: nextUnread,
      })
    },

    /** `read` — моё прочтение гасит unread/горизонт, чужое двигает peerReadSeq (✓✓). */
    applyRead(e: ReadEvt, meId: number | null): void {
      const cur = findDialog(e.chat_id)
      if (!cur) return
      if (e.user_id === meId) {
        // Wave 3: авторитетный unread из кадра verbatim (обычно 0); локальный =0 — fallback.
        const unread = e.unread ?? 0
        const lastReadSeq = Math.max(cur.lastReadSeq, e.up_to_seq)
        // Идемпотентность: повторное эхо того же прочтения (up_to_seq ≤ горизонта,
        // unread уже 0) НЕ публикует операцию — иначе на зеркале перезапустится
        // mark-read-эффект (деп win.msgs) и получится бесконечный цикл ре-рендера.
        if (unread === cur.unread && cur.unreadMentions === 0 && cur.unreadReactions === 0 && lastReadSeq === cur.lastReadSeq) return
        patchDialog(e.chat_id, { unread, unreadMentions: 0, unreadReactions: 0, lastReadSeq })
      } else {
        // the OTHER side read my messages → advance the peer horizon (out ticks → ✓✓)
        const peerReadSeq = Math.max(cur.peerReadSeq, e.up_to_seq)
        if (peerReadSeq === cur.peerReadSeq) return // no advance → no-op (без операции)
        patchDialog(e.chat_id, { peerReadSeq })
      }
    },

    // Бэкенд шлёт в `chat_update` АБСОЛЮТНЫЙ снимок метаданных чата
    // (backend/internal/usecase/chat/chat_update.go:18-42) — сливаем его в
    // существующий диалог, в сеть за списком не ходим.
    applyChatMeta(e: ChatUpdateEvt): void {
      const cur = findDialog(e.chat_id)
      if (!cur) return // чата нет в списке — приедет со следующей загрузкой
      // Пишем только те поля, что реально пришли в снимке: '' и null — это
      // «сброшено» (снимок абсолютный), отсутствие ключа — «не про это событие».
      const fields: Partial<Dialog> = {
        ...(e.title !== undefined && { title: e.title }),
        // username кладём verbatim — ровно как маппинг ответа /chats (models.ts:675).
        ...(e.username !== undefined && { username: e.username }),
        ...(e.photo_media_id !== undefined && {
          // Тот же путь, что отдаёт /chats (backend chatsrepo.go:190) — НЕ готовый
          // URL с медиа-токеном: токен живёт ~15 минут, в долгоживущую модель его класть нельзя.
          photoUrl: e.photo_media_id === null ? undefined : `/media/${e.photo_media_id}/content`,
        }),
      }
      patchDialog(e.chat_id, fields)
    },

    // Кто-то поставил реакцию на МОЁ сообщение → бампим бейдж непрочитанных
    // реакций диалога (Telegram unread_reactions_count). Сброс — на applyRead.
    bumpUnreadReactions(chatId: number, count?: number): void {
      const cur = findDialog(chatId)
      if (!cur) return
      // Авторитетный счётчик из кадра (reaction.unread_reactions) — verbatim, как
      // unread у new_message/read; локальный +1 — fallback, если поля нет.
      const value = typeof count === 'number' ? count : (cur.unreadReactions ?? 0) + 1
      patchDialog(chatId, { unreadReactions: value })
    },

    // Меня удалили из группы / вышел сам (chat_removed) — диалог исчезает из списка.
    applyRemoved(chatId: number): void {
      const idx = items.findIndex((i) => i.dialog.chatId === chatId)
      if (idx === -1) return // не было в кэше — нечего убирать
      items = items.filter((i) => i.dialog.chatId !== chatId)
      publish([{ op: 'remove', chatId }])
    },

    // ── Task 4 (действия без оптимистики) ─────────────────────────────────────
    // Порт tweb: `invokeApi(...).then(saveUpdate)` — сеть уже подтвердила, ЗАТЕМ
    // применяем. Сетевые менеджеры (groupsManager/chatThemesManager) зовут эти
    // методы ПОСЛЕ успешного REST-ответа; при ошибке они не зовутся вовсе — см.
    // dialogsManager.test.ts «RPC упал — ни одной операции».

    /** Пер-чатовый mute (messages.setMute) — то же поле, что и realtime-эхо dialog_mute. */
    applyMute(chatId: number, muted: boolean): void {
      patchDialog(chatId, { muted })
    },

    /** В архив / из архива — пин сбрасывается (как на бэке, group_settings.go). */
    applyArchived(chatId: number, archived: boolean): void {
      patchDialog(chatId, { archived, pinned: false })
    },

    /** Тема оформления чата (messages.setChatTheme) — пустая строка сбрасывает к дефолту. */
    applyTheme(chatId: number, themeId: string): void {
      patchDialog(chatId, { themeId: themeId || undefined })
    },

    /**
     * Пин/анпин двигает и ПОРЯДОК: свежий пин встаёт первым (порт tweb
     * `order.unshift`, dialogs.ts:934), анпин выпадает из порядка. Порядок
     * закреплённых — общий State-ключ на весь список (см. докблок ALL_FOLDER_ID
     * выше и прежний chatsStore.setDialogPinned, откуда перенесена логика).
     * Пишем на диск и рассылаем зеркало ключа тем же путём, что
     * `persistManager.stateKey` (`saveStateKey` + `mirrorStateKey` в
     * workerCore.ts) — второй писатель того же ключа не заводится.
     *
     * Fix (ревью Task 4, Critical): пин/анпин — ФАКТ (булево поле диалога), а не
     * команда «переставь». `order.unshift` оправдан только при РЕАЛЬНОМ переходе
     * `pinned` false↔true; повторный/запоздавший кадр того же уже применённого
     * факта (собственное WS-эхо — бэкенд шлёт `dialog_pin` на ВСЕ соединения
     * пользователя, включая инициировавшее: `backend/internal/adapter/delivery/
     * ws/hub.go:203-209`, во фрейме нет id соединения, фильтровать нечем) не
     * должен трогать уже устоявшийся `pinnedOrder` — иначе чат, запиненный
     * РАНЬШЕ, задним числом обгоняет чат, запиненный ПОЗЖЕ (порядок событий:
     * apply(1,true) → apply(2,true) → запоздавшее эхо apply(1,true) снова
     * бросало бы 1 на вершину, ломая [2,1,…] обратно на [1,2,…]). Гвард —
     * ровно та же идея, что `equal()` в `patchDialog`: нечего менять — не
     * трогаем ни кэш, ни диск, ни зеркало.
     *
     * Отличимость от «легитимного перепина уже закреплённого чата» (чтобы
     * снова всплыть наверх): такого действия в продукте НЕТ — UI показывает
     * либо «Pin» у незакреплённого чата, либо «Unpin» у закреплённого
     * (`ChatListItem.tsx`: `chat.pinned ? 'Unpin' : 'Pin'`), кнопки «запинить
     * заново уже запиненный, чтобы поднять его» не существует ни у нас, ни в
     * tweb (порядок закреплённых меняется явным drag'ом, которого в этом
     * клиенте тоже нет). Единственный путь получить `applyPinned(id, true)` с
     * уже `pinned===true` — дубль/эхо ОДНОГО И ТОГО ЖЕ действия. Различить
     * «дубль» от «легитимного намерения поднять» по одним лишь текущим данным
     * (без монотонного номера действия в кадре) НЕЛЬЗЯ — если такая фича
     * появится, `dialog_pin` придётся снабдить версией/меткой времени.
     */
    applyPinned(chatId: number, pinned: boolean): void {
      const idx = items.findIndex((i) => i.dialog.chatId === chatId)
      if (idx === -1) return
      const cur = items[idx].dialog
      if (cur.pinned === pinned) return // факт уже применён — не переставляем и не пишем повторно
      const others = pinnedOrder.filter((id) => id !== chatId)
      pinnedOrder = pinned ? [chatId, ...others] : others
      pinnedOrders = { ...pinnedOrders, [ALL_FOLDER_ID]: pinnedOrder }
      void savePinnedOrders?.(pinnedOrders)
      mirrorStateKey?.('pinnedOrders', pinnedOrders)
      const dialog: Dialog = { ...cur, pinned }
      items = sort(items.map((i) => (i.dialog.chatId === chatId ? dialog : i.dialog)))
      publish([
        { op: 'patch', chatId, fields: { pinned } },
        { op: 'reindex', items: items.map((i) => ({ chatId: i.dialog.chatId, index: i.index })) },
      ])
    },
  }
}
export type DialogsManager = ReturnType<typeof newDialogsManager>
