// src/components/Chat.feedMount.test.ts
//
// Пин точки монтирования императивной ленты (`chat/bubbles.ts` через
// `chat/VanillaFeed.tsx`) в `Chat.tsx` — и того набора пропов, без которых она
// молча работает неправильно.
//
// Почему СКАН ИСХОДНИКА, а не рендер компонента. Норма покрытия проводки
// (web-client/CLAUDE.md, «Тесты») требует, чтобы удаление строки красило тест;
// `Chat.tsx` при этом — заявленное там же исключение: ни один тест её не
// импортирует, отрендерить её в vitest нельзя (самый большой компонент клиента,
// тянет за собой сокет, воркерные менеджеры, скролл и десятки хуков). Норма от
// этого не выключается — она требует ЛИБО теста, ЛИБО пометки с причиной,
// поэтому здесь ровно тот же приём, которым репозиторий уже держит инварианты
// исходников: `core/scrollWriters.test.ts`, `stores/noManualOrder.test.ts`,
// `core/state/noAdHocReads.test.ts` — читаем файл текстом.
//
// Раньше здесь стоял пин на РАЗВИЛКУ `AppConfig.vanillaFeed ? <VanillaFeed …> :
// <ChatFeed …>` и на «дефолт ведёт в React-ленту». Развилки больше нет: этап 7
// снёс React-ленту и флаг вместе с ней, лента в `Chat.tsx` ровно одна. Предмет
// пина при этом остался тем же — точка монтирования и её пропы.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHAT_TSX = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')
const FEED_JSX = CHAT_TSX.match(/<VanillaFeed[^/>]*\/>/)?.[0] ?? ''

describe('Chat.tsx — монтирование императивной ленты', () => {
  it('импортирует VanillaFeed и монтирует его безусловно (развилки нет)', () => {
    expect(CHAT_TSX).toMatch(/^import VanillaFeed, \{ type ChatFeedApi \} from '\.\/chat\/VanillaFeed'$/m)
    expect(FEED_JSX).not.toBe('')
    // Второй ленты в клиенте не осталось: ни компонента, ни флага под неё.
    expect(CHAT_TSX).not.toContain('ChatFeed ')
    expect(CHAT_TSX).not.toContain('AppConfig.vanillaFeed')
  })

  it('лента получает чат и тред — иначе она открыла бы чужое окно', () => {
    expect(FEED_JSX).toContain('peerId={numericChatId}')
    expect(FEED_JSX).toContain('threadRootId={threadRootId}')
  })

  // Вид чата ленте неоткуда взять самой (стор ей запрещён), а от него зависит
  // СТОРОНА бабла у отправки от лица канала (`Chat.isOurMessage`,
  // tweb chat.ts:1375-1377) и гейт имени автора. Оба признака — «открыт
  // групповой чат»: любая наша группа это `channel` с `pFlags.megagroup`.
  it('лента получает вид чата: isLikeGroup и isMegagroup', () => {
    expect(FEED_JSX).toContain('isLikeGroup={isGroup}')
    expect(FEED_JSX).toContain('isMegagroup={isGroup}')
  })

  // Размер страницы истории у канала свой — 20 против общего pageCount (порт
  // tweb bubbles.ts:11389-11391 `isBroadcast ? 20 : ...`). Признак ленте
  // неоткуда взять самой, а без него канал грузил бы страницу вдвое больше.
  it('лента получает `isBroadcast` — иначе у канала не тот размер страницы', () => {
    expect(FEED_JSX).toContain('isBroadcast={isChannel}')
  })

  // Распорки `.bubbles-padding-top/-bottom` — порт tweb `Chat.recomputePaddings`
  // (chat.ts:345-365): числа считает окружение чата, применяет лента. Без них
  // распорки нулевые, и первая страница встаёт под топбаром, а последняя — под
  // композером.
  it('лента получает высоты распорок', () => {
    expect(FEED_JSX).toContain('paddingTopPx={padTopPx}')
    expect(FEED_JSX).toContain('paddingBottomPx={padBottomPx}')
  })

  // Ручки ленты наружу: прыжок к сообщению (поиск/закрепы/упоминания/вьювер),
  // кнопка «вниз», вход и выход из режима выделения, перезагрузка окна. Без
  // рефа `api` все они молча становятся no-op.
  it('лента отдаёт наружу ручки и свой скролл-контейнер', () => {
    expect(FEED_JSX).toContain('api={feedApi}')
    expect(FEED_JSX).toContain('scrollerRef={feedScrollRef}')
    expect(CHAT_TSX).toContain('feedApi.current?.jumpToMessage(mid)')
    expect(CHAT_TSX).toContain('feedApi.current?.goDown()')
    expect(CHAT_TSX).toContain('feedApi.current?.startSelection()')
    expect(CHAT_TSX).toContain('feedApi.current?.cancelSelection()')
    expect(CHAT_TSX).toContain('feedApi.current?.reload()')
  })

  // Контекстное меню сообщения — порт `chat/contextMenu.ts`; его носители
  // (попапы + вход в правку + скачивание) принадлежат хосту, лента только
  // объявляет намерение. Без этих трёх пропов меню поднимается пустым — все
  // семь попапов проваливаются в `undefined`.
  it('лента получает носителей контекстного меню: menuPopups, onEdit, onDownload', () => {
    expect(FEED_JSX).toContain('menuPopups={feedMenuPopups}')
    expect(FEED_JSX).toContain('onEdit={startEditFor}')
    expect(FEED_JSX).toContain('onDownload={downloadMedia}')
  })

  // Действия медиавьювера — прыжок, пересылка, удаление, догрузка соседей:
  // вьювер открывает лента, а всё перечисленное знает окружение чата.
  it('лента получает действия медиавьювера', () => {
    expect(FEED_JSX).toContain('mediaViewerActions={mediaViewerActions}')
    expect(CHAT_TSX).toContain('loadMoreMedia,')
  })

  // Ключевое: второго НАБОРА действий у ванильного меню нет — все семь попапов
  // ведут в те же функции `useMessageActions`.
  it('носители попапов — действия useMessageActions, а не собственные', () => {
    const table = CHAT_TSX.match(/const feedMenuPopups = \{[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(table).toContain('showPinMessage: pinMessage')
    expect(table).toContain('showDeleteMessages: openDeleteFor')
    expect(table).toContain('showMessageReport: openReportFor')
    expect(table).toContain('showStatistics: openPostStatsFor')
    expect(table).toContain('showFactCheckEditor: openFactCheckEditorFor')
    // Две записи — адаптеры формы (запись `{[peerId]: mids}` и якорь попапа),
    // но и они зовут те же действия; см. onFeedForward / onFeedReactedList.
    expect(table).toContain('showForward: onFeedForward')
    expect(table).toContain('showReactedList: onFeedReactedList')
    expect(CHAT_TSX).toContain('openForwardFor(Number(fromPeerId), mids)')
    expect(CHAT_TSX).toContain('void showReactedUsers(mid, at.x, at.y)')
  })
})
