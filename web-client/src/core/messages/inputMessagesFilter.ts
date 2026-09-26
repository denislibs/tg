// Фильтр сообщений поиска — порт tweb `MyInputMessagesFilter`
// (`lib/appManagers/appMessagesManager.ts:185-197`) в объёме наших ручек, и
// единственное место, где он встречается с лексикой REST.
//
// У оригинала перевода нет: `inputFilter` уходит в `messages.search`/
// `messages.searchGlobal` как есть (`:9975`, `:9990`). У нас между ними ручки
// REST с собственным словом `filter` (`messagesrepo.go::mediaFilterCond`), и
// переводят туда двое — диспетчер `messages.searchHistory` (воркер) и счётчики
// вкладок класса `AppSearchSuper` (`searchCounters`). Модуль отдельный, чтобы
// витрина не тянула в главный поток модуль менеджера ради таблицы.
//
// Из союза оригинала взяты только фильтры, которые ходят вкладками класса
// (`sharedMedia.tsx:604-648`, `sidebarLeft/index.ts:1128-1162`): остальные
// (`Photos`, `Video`, `Voice`, `RoundVideo`, `MyMentions`, `ChatPhotos`,
// `Pinned`) не зовёт ни один наш потребитель, и ручки под них нет.

export type MyInputMessagesFilter =
  'inputMessagesFilterEmpty' |
  'inputMessagesFilterPhotoVideo' |
  'inputMessagesFilterDocument' |
  'inputMessagesFilterUrl' |
  'inputMessagesFilterMusic' |
  'inputMessagesFilterRoundVoice'

/** Вид сообщений на проводе (`GET /chats/{id}/media|search?filter=…`, `GET /search/messages?filter=…`). */
export type MessagesWireFilter = 'media' | 'files' | 'links' | 'music' | 'voice'

/** `inputMessagesFilterEmpty` не переводится: «любой вид» на проводе — ОТСУТСТВИЕ фильтра. */
export const INPUT_FILTER_WIRE: Record<Exclude<MyInputMessagesFilter, 'inputMessagesFilterEmpty'>, MessagesWireFilter> = {
  inputMessagesFilterPhotoVideo: 'media',
  inputMessagesFilterDocument: 'files',
  inputMessagesFilterUrl: 'links',
  inputMessagesFilterMusic: 'music',
  inputMessagesFilterRoundVoice: 'voice',
}

export function getWireFilter(inputFilter: MyInputMessagesFilter): MessagesWireFilter | undefined {
  return inputFilter === 'inputMessagesFilterEmpty' ? undefined : INPUT_FILTER_WIRE[inputFilter]
}
