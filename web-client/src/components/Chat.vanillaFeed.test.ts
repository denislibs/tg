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
