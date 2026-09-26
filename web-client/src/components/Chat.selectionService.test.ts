// src/components/Chat.selectionService.test.ts
//
// Пин tweb e9428f2a9: служебное сообщение теперь выделяется (`canSelectBubble`,
// `chat/selection.ts`), а переслать его нельзя — у оригинала `canForward` для
// `messageService` ложен, и плашка выделения прячет «Переслать», как только
// такое сообщение попало в выбор. Факта «нельзя переслать» у нас на клиенте
// нет вовсе (`cantForwardDeleteMids` не передаётся, VanillaFeed.tsx), поэтому
// правило для служебных считает хост плашки — `Chat.tsx`.
//
// Почему СКАН ИСХОДНИКА: см. `Chat.feedMount.test.ts` (Chat.tsx не рендерится
// в vitest — заявленное исключение web-client/CLAUDE.md).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHAT_TSX = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')
const BAR_JSX = CHAT_TSX.match(/<SelectionBar[\s\S]*?\/>/)?.[0] ?? ''

describe('Chat.tsx — «Переслать» гаснет на служебном в выделении (tweb e9428f2a9)', () => {
  it('признак считается по зеркалу окна: есть ли среди выбранных messageService', () => {
    expect(CHAT_TSX).toMatch(/const selectedHasService = useMemo\(\s*\(\) => selected\.size > 0 && mirrorMsgs\.some\(\(m\) => m\._ === 'messageService' && selected\.has\(m\.id\)\)/)
  })

  it('плашка получает его в canForward', () => {
    expect(BAR_JSX).toContain('canForward={!isSecret && !selectedHasService}')
  })
})
