// src/components/Chat.specialPeers.test.ts
//
// Пин шапки чата у особых пиров (порт tweb topbar.ts `createStatus` и
// appImManager.getUserStatus). СКАН ИСХОДНИКА по той же причине, что
// `Chat.feedMount.test.ts`: `Chat.tsx` в vitest не рендерится (докблок там).
// Чистые части вынесены и проверены поведенчески — `getUserStatusString`/
// `userHasPresence` (`core/presence.test.ts`), счёт истории
// (`messagesManager.test.ts`, `storeProjection.historyCount.test.ts`); здесь —
// только то, что `Chat.tsx` их ЗОВЁТ так, как оригинал.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHAT_TSX = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')
const HEADER_TSX = readFileSync(join(__dirname, 'conversation/ChatHeader.tsx'), 'utf8')

describe('Chat.tsx — шапка особых пиров', () => {
  it('«Избранное»: подпись — «N messages» из счёта истории окна, до него — Loading (topbar.ts messagesCounter)', () => {
    expect(CHAT_TSX).toMatch(/const savedCount = useMirrorHistoryCount\(isRealChat && isSaved && !thread \? winKey\(numericChatId\) : null\)/)
    expect(CHAT_TSX).toMatch(/savedCount == null \? t\('Loading'\) : tArgs\('messages', \[savedCount\]\)/)
    expect(CHAT_TSX).toMatch(/const headerStatus = savedStatus \?\? /)
  })

  it('подпись собеседника получает КАРТОЧКУ пира (ветки служебного аккаунта/бота — по ней)', () => {
    expect(CHAT_TSX).toMatch(/<PeerStatus user=\{privatePeer\} status=\{peerPresence\} \/>/)
  })

  it('бот и служебный аккаунт — без typing и подсветки «в сети» (appImManager :3725)', () => {
    expect(CHAT_TSX).toMatch(/const isHumanPeer = userHasPresence\(privatePeer\)/)
    expect(CHAT_TSX).toMatch(/const headerTypingActive = typingLabel\.active && \(chat\.type !== 'private' \|\| isHumanPeer\)/)
    expect(CHAT_TSX).toMatch(/const headerOnline = \(chat\.type === 'private' && isHumanPeer && isUserStatusOnline/)
  })
})

describe('ChatHeader.tsx — аватар шапки без онлайн-точки', () => {
  // У оригинала онлайн-точку ставит только список чатов
  // (`autonomousDialogList/dialogs.ts:310` `setOnlineStatus`); аватар шапки
  // (`topbar.ts:1402-1412`, `avatarNew`) её не несёт — иначе на «Избранном»
  // она горела бы, пока онлайн сам зритель.
  it('Avatar шапки не получает online', () => {
    const avatar = HEADER_TSX.match(/<Avatar\n[\s\S]*?\/>/)?.[0] ?? ''
    expect(avatar).toContain('className="person-avatar"')
    expect(avatar).not.toMatch(/\bonline\b/)
  })
})
