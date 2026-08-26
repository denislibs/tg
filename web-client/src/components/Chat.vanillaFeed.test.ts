// src/components/Chat.vanillaFeed.test.ts
//
// Пин точки монтирования императивной ленты (`chat/bubbles.ts` через
// `chat/VanillaFeed.tsx`) в `Chat.tsx`.
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
// Что именно ловится: удаление ветки `AppConfig.vanillaFeed ? <VanillaFeed …>`
// (перенос ленты молча перестал бы монтироваться — и этап 7 обнаружил бы это
// только руками), удаление импорта, и подмена гейта на что-то, что не читает
// флаг.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppConfig } from '../config/app'

const CHAT_TSX = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')

describe('Chat.tsx — монтирование императивной ленты под флагом', () => {
  it('импортирует VanillaFeed и флаг сборки', () => {
    expect(CHAT_TSX).toMatch(/^import VanillaFeed from '\.\/chat\/VanillaFeed'$/m)
    expect(CHAT_TSX).toMatch(/^import \{ AppConfig \} from '\.\.\/config\/app'$/m)
  })

  it('развилка гейтится AppConfig.vanillaFeed, в truthy-ветке — <VanillaFeed>', () => {
    expect(CHAT_TSX).toMatch(/\{AppConfig\.vanillaFeed \? \(\s*<VanillaFeed\b/)
  })

  it('лента получает чат и тред — иначе она открыла бы чужое окно', () => {
    const jsx = CHAT_TSX.match(/<VanillaFeed[^/>]*\/>/)?.[0] ?? ''
    expect(jsx).toContain('peerId={numericChatId}')
    expect(jsx).toContain('threadRootId={threadRootId}')
  })

  // Вид чата ленте неоткуда взять самой (стор ей запрещён), а от него зависит
  // СТОРОНА бабла у отправки от лица канала (`Chat.isOurMessage`,
  // tweb chat.ts:1375-1377) и гейт имени автора. Оба признака — «открыт
  // групповой чат»: любая наша группа это `channel` с `pFlags.megagroup`.
  it('лента получает вид чата: isLikeGroup и isMegagroup', () => {
    const jsx = CHAT_TSX.match(/<VanillaFeed[^/>]*\/>/)?.[0] ?? ''
    expect(jsx).toContain('isLikeGroup={isGroup}')
    expect(jsx).toContain('isMegagroup={isGroup}')
  })

  // Размер страницы истории у канала свой — 20 против общего pageCount (порт
  // tweb bubbles.ts:11389-11391 `isBroadcast ? 20 : ...`). Признак ленте
  // неоткуда взять самой, а без него канал грузил бы страницу вдвое больше.
  it('лента получает `isBroadcast` — иначе у канала не тот размер страницы', () => {
    const jsx = CHAT_TSX.match(/<VanillaFeed[^/>]*\/>/)?.[0] ?? ''
    expect(jsx).toContain('isBroadcast={isChannel}')
  })

  // Контекстное меню сообщения — порт `chat/contextMenu.ts`; его носители
  // (попапы + вход в правку + скачивание) принадлежат хосту, лента только
  // объявляет намерение. Без этих трёх пропов меню поднимается пустым — все
  // семь попапов проваливаются в `undefined`.
  it('лента получает носителей контекстного меню: menuPopups, onEdit, onDownload', () => {
    const jsx = CHAT_TSX.match(/<VanillaFeed[^/>]*\/>/)?.[0] ?? ''
    expect(jsx).toContain('menuPopups={feedMenuPopups}')
    expect(jsx).toContain('onEdit={startEditFor}')
    expect(jsx).toContain('onDownload={downloadMedia}')
  })

  // Ключевое: второго НАБОРА действий у ванильного меню нет — все семь попапов
  // ведут в те же функции `useMessageActions`, что и пункты React-меню.
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

  it('React-лента — ровно ВТОРАЯ ветка той же развилки (обе не живут одновременно)', () => {
    // Один гейт на весь блок: два независимых условия рано или поздно разъедутся
    // и дали бы две ленты в одном .chat сразу.
    expect(CHAT_TSX.match(/AppConfig\.vanillaFeed/g)).toHaveLength(1)

    const gate = CHAT_TSX.indexOf('{AppConfig.vanillaFeed ?')
    const elseBranch = CHAT_TSX.indexOf(') : (', gate)
    expect(gate).toBeGreaterThan(-1)
    expect(elseBranch).toBeGreaterThan(gate)
    // <ChatFeed …> (React-лента) лежит ПОСЛЕ `) : (`, то есть в else-ветке.
    expect(CHAT_TSX.indexOf('<ChatFeed', gate)).toBeGreaterThan(elseBranch)
  })

  it('в тестовой/дефолтной сборке живой остаётся React-лента', () => {
    // Дубль пина из config/app.test.ts, но с точки зрения потребителя: пока
    // этапы 3-6 не сделаны, дефолт обязан вести в else-ветку.
    expect(AppConfig.vanillaFeed).toBe(false)
  })
})
