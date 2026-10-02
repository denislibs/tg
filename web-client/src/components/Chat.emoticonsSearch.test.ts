// src/components/Chat.emoticonsSearch.test.ts
//
// Пин проводки 0б-11: вкладки «Поиск стикеров»/«Поиск GIF» правой колонки
// отправляют выбранное через `appImManager.chat.input.sendMessageWithDocument`
// (tweb `stickers.tsx:174`, `gifs.tsx:77`). `appImManager.chat` — инстанс стека
// (`components/chat/reactChatInstance.ts`, ВРЕМЕННО до К-3), а его `input` отдаёт
// АКТИВНЫЙ остров `Chat.tsx`. Без этой строки вкладки открываются, ищут и рисуют,
// но клик по стикеру/GIF никуда не уходит — и ни один тест вкладок этого не видит
// (там `appImManager.chat` подменяет сам тест).
//
// Почему СКАН ИСХОДНИКА — то же основание, что у `Chat.feedMount.test.ts`:
// `Chat.tsx` в vitest не рендерится (заявленное исключение, web-client/CLAUDE.md).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHAT_TSX = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')

/** Тело `useEffect`, который отдаёт `input`: от `useEffect(() => {` до его `}, [deps])`. */
function bridgeEffect(): { body: string, deps: string } {
  const at = CHAT_TSX.indexOf('instance.input = input')
  if (at === -1) return { body: '', deps: '' }
  const start = CHAT_TSX.lastIndexOf('useEffect(() => {', at)
  const close = CHAT_TSX.indexOf('}, [', at)
  const depsEnd = CHAT_TSX.indexOf('])', close)
  return { body: CHAT_TSX.slice(start, close), deps: CHAT_TSX.slice(close + 4, depsEnd) }
}

describe('Chat.tsx — `appImManager.chat.input` для вкладок поиска стикеров/GIF', () => {
  it('отдаёт input своему инстансу только активным и снимает его на уходе', () => {
    const { body, deps } = bridgeEffect()
    expect(body).toContain('if (!isActiveInstance || !instance) return')
    expect(body).toContain('instance.input = input')
    // снимает ТОЛЬКО своё: эффект мог перезапуститься с новым колбэком
    expect(body).toMatch(/if \(instance\.input === input\) instance\.input = undefined/)
    expect(body).toContain('sendMessageWithDocument: sendDocumentFromSearch')
    expect(deps.split(',').map((d) => d.trim())).toEqual(['isActiveInstance', 'instance', 'sendDocumentFromSearch'])
  })

  it('отправка гейтится теми же правами, что пикер композера, и различает стикер и GIF', () => {
    const at = CHAT_TSX.indexOf('const sendDocumentFromSearch = useEvent(')
    expect(at).toBeGreaterThan(-1)
    const body = CHAT_TSX.slice(at, CHAT_TSX.indexOf('\n  })', at))
    expect(body).toContain('if (!canSendStickers) return false')
    expect(body).toContain("if ('_' in document) onComposerPickSticker(document)")
    expect(body).toContain('else onComposerPickGif(document)')
    expect(body).toContain('return true')
  })
})
