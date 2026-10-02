// src/components/Chat.emoticonsSearch.test.ts
//
// Пин проводки 0б-11: вкладки «Поиск стикеров»/«Поиск GIF» правой колонки
// отправляют выбранное через `appImManager.chat.input.sendMessageWithDocument`
// (tweb `stickers.tsx:174`, `gifs.tsx:77`). Класса `AppImManager` нет до Э4-3,
// поэтому `appImManager.chat` — мост (`sidebarRight/tabs/emoticonsSearchBridge.ts`),
// и ставит его АКТИВНЫЙ инстанс `Chat.tsx`. Без этой строки вкладки открываются,
// ищут и рисуют, но клик по стикеру/GIF никуда не уходит — и ни один тест вкладок
// этого не видит (там мост ставит сам тест).
//
// Почему СКАН ИСХОДНИКА — то же основание, что у `Chat.feedMount.test.ts`:
// `Chat.tsx` в vitest не рендерится (заявленное исключение, web-client/CLAUDE.md).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHAT_TSX = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')

/** Тело `useEffect`, который ставит мост: от `useEffect(() => {` до его `}, [deps])`. */
function bridgeEffect(): { body: string, deps: string } {
  const at = CHAT_TSX.indexOf('appImManager.chat = chatBridge')
  if (at === -1) return { body: '', deps: '' }
  const start = CHAT_TSX.lastIndexOf('useEffect(() => {', at)
  const close = CHAT_TSX.indexOf('}, [', at)
  const depsEnd = CHAT_TSX.indexOf('])', close)
  return { body: CHAT_TSX.slice(start, close), deps: CHAT_TSX.slice(close + 4, depsEnd) }
}

describe('Chat.tsx — мост appImManager.chat для вкладок поиска стикеров/GIF', () => {
  it('ставит себя в мост только активным инстансом и снимает себя на уходе', () => {
    const { body, deps } = bridgeEffect()
    expect(body).toContain('if (!isActiveInstance) return')
    expect(body).toContain('appImManager.chat = chatBridge')
    // снимает ТОЛЬКО себя: новый активный инстанс мог уже поставить свой мост
    expect(body).toMatch(/if \(appImManager\.chat === chatBridge\) appImManager\.chat = undefined/)
    expect(body).toContain('peerId: numericChatId')
    expect(body).toContain('sendMessageWithDocument: sendDocumentFromSearch')
    expect(deps.split(',').map((d) => d.trim())).toEqual(['isActiveInstance', 'numericChatId', 'sendDocumentFromSearch'])
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
