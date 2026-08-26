// src/core/hooks/useChatSend.test.tsx
//
// Пакет параметров отправки (порт tweb `MessageSendingParams` +
// `Chat.getMessageSendingParams`) и сброс плашки ответа (порт tweb
// `ChatInput.onMessageSent → clearHelper`).
//
// ЧТО ЛОМАЕТСЯ БЕЗ ЭТОГО. До порта `replyToId`/цитату/`silent`/эффект/send-as
// знал ровно ОДИН путь — текстовый; стикер, гиф, файл, голосовое, кружок, гео,
// контакт уходили без них (одиннадцать красных клеток матрицы А,
// docs/readiness/message-matrix.md). Вторая половина того же дефекта — плашка:
// её гасил тоже только текстовый путь, поэтому после отправки стикера при
// открытом ответе плашка оставалась висеть, и СЛЕДУЮЩЕЕ сообщение уходило
// ответом, которого пользователь уже не ждёт. Оба свойства проверяются здесь по
// каждому пути отдельно — «протянуто у одного» тут не считается.
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { Chat } from '../../data'
import { ManagersProvider } from './useManagers'
import { useChatSend } from './useChatSend'
import { makeSticker } from '../stickers/testSticker'

// Голос/кружок приходят из useVoiceRecorder колбэком onComplete — подменяем
// модуль, чтобы дёрнуть колбэк напрямую (микрофона в тестовой среде нет).
const recorderOpts: { current: { onComplete: (r: unknown) => Promise<void> } | null } = { current: null }
vi.mock('./useVoiceRecorder', () => ({
  useVoiceRecorder: (opts: { onComplete: (r: unknown) => Promise<void> }) => {
    recorderOpts.current = opts
    return { recording: false }
  },
}))

const CHAT_ID = 11
const ME = 5
const ORIG = 77 // id сообщения, на которое отвечаем

function chat(over: Partial<Chat> = {}): Chat {
  return { id: String(CHAT_ID), name: 'Чат', avatar: '', date: '', preview: '', ...over } as Chat
}

function makeManagers() {
  const m = {
    messages: {
      // Аргументы объявлены явно: без них `mock.calls[0][0]` — элемент пустого
      // кортежа, и проверка «что уехало» не типизируется.
      sendText: vi.fn(async (_a: Record<string, unknown>) => ({ ok: true as const })),
      sendFile: vi.fn(async (_a: Record<string, unknown>) => ({ mediaId: 909 })),
      sendGeoLive: vi.fn(async (..._a: unknown[]) => ({ id: 1 })),
      forwardMessages: vi.fn(async () => []),
      editMessage: vi.fn(async () => ({})),
    },
    secret: {
      sendText: vi.fn(async (_a: Record<string, unknown>) => ({ ok: true })),
      sendMedia: vi.fn(async (_a: Record<string, unknown>) => ({ ok: true })),
    },
    stickers: { use: vi.fn(async () => {}), saveGif: vi.fn(async () => {}) },
    chats: { createPrivate: vi.fn(async () => CHAT_ID) },
    channels: { post: vi.fn(async (..._a: unknown[]) => ({})) },
    realtime: { sendTyping: vi.fn(async () => {}) },
  }
  return m
}

function setup(over: Record<string, unknown> = {}) {
  const managers = makeManagers()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
  )
  const { result } = renderHook(
    () => useChatSend({
      chat: (over.chat as Chat) ?? chat(),
      numericChatId: CHAT_ID,
      isRealChat: true,
      isChannel: false,
      draftPeerId: null,
      canType: true,
      meId: ME,
      ...over,
    }),
    { wrapper },
  )
  return { managers, result }
}

/** Открыть плашку ответа — ровно так же, как это делает контекст-меню. */
function openReply(result: { current: ReturnType<typeof useChatSend> }, over: Record<string, unknown> = {}) {
  act(() => { result.current.setReply({ msgId: ORIG, name: 'Маша', text: 'привет', color: 'red', ...over }) })
}

const file = (name = 'doc.txt', type = 'text/plain') => new File(['x'], name, { type })

beforeEach(() => { recorderOpts.current = null })

describe('useChatSend: пакет параметров доезжает КАЖДЫМ путём отправки', () => {
  it('стикер уходит ответом', async () => {
    const { managers, result } = setup()
    openReply(result)
    act(() => { result.current.sendSticker(makeSticker({ id: 500, emoji: '😀' })) })
    await waitFor(() => expect(managers.messages.sendText).toHaveBeenCalled())
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ type: 'sticker', replyToMsgId: ORIG })
  })

  it('сохранённый гиф уходит ответом', async () => {
    const { managers, result } = setup()
    openReply(result)
    act(() => { result.current.sendGif({ id: 'g', mediaId: 501, width: 1, height: 1 } as never) })
    await waitFor(() => expect(managers.messages.sendText).toHaveBeenCalled())
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ type: 'video', replyToMsgId: ORIG })
  })

  it('гиф из Tenor (аплоад mp4) уходит ответом', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['v']) })))
    const { managers, result } = setup()
    openReply(result)
    act(() => { result.current.sendGif({ id: 'g', mp4Url: 'https://t/g.mp4', width: 1, height: 1 } as never) })
    await waitFor(() => expect(managers.messages.sendFile).toHaveBeenCalled())
    expect(managers.messages.sendFile.mock.calls[0][0]).toMatchObject({ type: 'video', replyToMsgId: ORIG })
    vi.unstubAllGlobals()
  })

  it('файл из попапа отправки уходит ответом', async () => {
    const { managers, result } = setup()
    openReply(result)
    act(() => { result.current.setPendingMedia({ files: [file()], asFile: true }) })
    await act(async () => { await result.current.sendPendingMedia('подпись', true) })
    expect(managers.messages.sendFile.mock.calls[0][0]).toMatchObject({ type: 'document', replyToMsgId: ORIG })
  })

  it('все файлы одной выборки несут один и тот же пакет (tweb: пакет снимается до iterate)', async () => {
    const { managers, result } = setup()
    openReply(result)
    act(() => { result.current.setPendingMedia({ files: [file('a.txt'), file('b.txt')], asFile: true }) })
    await act(async () => { await result.current.sendPendingMedia('', true) })
    expect(managers.messages.sendFile).toHaveBeenCalledTimes(2)
    for (const c of managers.messages.sendFile.mock.calls) expect(c[0]).toMatchObject({ replyToMsgId: ORIG })
  })

  it('голосовое уходит ответом', async () => {
    const { managers, result } = setup()
    openReply(result)
    await act(async () => {
      await recorderOpts.current!.onComplete({ secs: 2, blob: new Blob(['a']), mime: 'audio/ogg', mode: 'voice', waveform: null })
    })
    expect(managers.messages.sendFile.mock.calls[0][0]).toMatchObject({ type: 'voice', replyToMsgId: ORIG })
  })

  it('кружок уходит ответом', async () => {
    const { managers, result } = setup()
    openReply(result)
    await act(async () => {
      await recorderOpts.current!.onComplete({ secs: 2, blob: new Blob(['a']), mime: 'video/mp4', mode: 'round', waveform: null })
    })
    expect(managers.messages.sendFile.mock.calls[0][0]).toMatchObject({ type: 'roundVideo', replyToMsgId: ORIG })
  })

  it('гео-точка уходит ответом', () => {
    const { managers, result } = setup()
    openReply(result)
    act(() => { result.current.sendGeo(1, 2) })
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ type: 'geo', replyToMsgId: ORIG })
  })

  it('live-гео (REST-путь) тоже получает пакет', () => {
    const { managers, result } = setup()
    openReply(result)
    act(() => { result.current.sendGeo(1, 2, { livePeriod: 900 }) })
    expect(managers.messages.sendGeoLive.mock.calls[0][5]).toMatchObject({ replyToMsgId: ORIG })
  })

  it('контакт уходит ответом', () => {
    const { managers, result } = setup()
    openReply(result)
    act(() => { result.current.sendContact(42, 'Маша') })
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ type: 'contact', replyToMsgId: ORIG })
  })

  it('тред: threadId едет пакетом, а не отдельным аргументом каждого пути', async () => {
    const { managers, result } = setup({ threadRootId: 3 })
    act(() => { result.current.sendSticker(makeSticker({ id: 500, emoji: '😀' })) })
    await waitFor(() => expect(managers.messages.sendText).toHaveBeenCalled())
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ threadId: 3 })
  })
})

describe('useChatSend: цитата', () => {
  it('текстовый путь несёт текст и offset цитаты', () => {
    const { managers, result } = setup()
    openReply(result, { quote: { text: 'вет', offset: 4 } })
    act(() => { result.current.send('ответ') })
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({
      replyToMsgId: ORIG, replyToQuote: { text: 'вет', offset: 4 },
    })
  })

  it('цитата доезжает и не-текстовым путём (стикер): пакет один на все пути', async () => {
    const { managers, result } = setup()
    openReply(result, { quote: { text: 'вет', offset: 4 } })
    act(() => { result.current.sendSticker(makeSticker({ id: 500, emoji: '😀' })) })
    await waitFor(() => expect(managers.messages.sendText).toHaveBeenCalled())
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ replyToQuote: { text: 'вет', offset: 4 } })
  })

  // Кросс-чат ответ: на провод уходит ССЫЛКА (чат оригинала), а снимка превью
  // рядом с ней больше нет. `snapshotName`/`snapshotText` остались состоянием
  // ПЛАШКИ композера (`ReplyWrapper`) — оригинал зрителю недоступен, и до эха
  // сервера превью показывать неоткуда; в бабл эти строки не едут, его плашку
  // строит рендерер из `reply_to.reply_from`/`reply_media`.
  it('кросс-чат ответ: в пакет едет ССЫЛКА на чат, снимок превью — не едет', () => {
    const { managers, result } = setup()
    openReply(result, { sourcePeerId: 99, snapshotName: 'Петя', snapshotText: 'оригинал' })
    act(() => { result.current.sendContact(42, 'Маша') })
    const args = managers.messages.sendText.mock.calls[0][0]
    expect(args).toMatchObject({ replyToMsgId: ORIG, replyToPeerId: 99 })
    expect(args.optimistic as Record<string, unknown>).not.toHaveProperty('replySnapshot')
  })
})

// Порт tweb `ChatInput.onMessageSent()` — отдельный вызов после КАЖДОЙ отправки.
// Мутация «убрать сброс у стикера» обязана красить второй assert каждой строки.
describe('useChatSend: плашка ответа гаснет после отправки ЛЮБЫМ путём', () => {
  const paths: [string, (r: { current: ReturnType<typeof useChatSend> }) => void | Promise<void>][] = [
    ['текст', (r) => { r.current.send('привет') }],
    ['стикер', (r) => { r.current.sendSticker(makeSticker({ id: 500, emoji: '😀' })) }],
    ['гиф', (r) => { r.current.sendGif({ id: 'g', mediaId: 501, width: 1, height: 1 } as never) }],
    ['гео', (r) => { r.current.sendGeo(1, 2) }],
    ['live-гео', (r) => { r.current.sendGeo(1, 2, { livePeriod: 900 }) }],
    ['контакт', (r) => { r.current.sendContact(42, 'Маша') }],
    ['голосовое', () => recorderOpts.current!.onComplete({ secs: 2, blob: new Blob(['a']), mime: 'audio/ogg', mode: 'voice', waveform: null })],
    ['кружок', () => recorderOpts.current!.onComplete({ secs: 2, blob: new Blob(['a']), mime: 'video/mp4', mode: 'round', waveform: null })],
  ]

  for (const [name, run] of paths) {
    it(`${name}: плашка снята, следующее сообщение уходит БЕЗ ответа`, async () => {
      const { managers, result } = setup()
      openReply(result)
      await act(async () => { await run(result) })
      expect(result.current.reply).toBeNull()

      managers.messages.sendText.mockClear()
      act(() => { result.current.send('следующее') })
      expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ replyToMsgId: null })
    })
  }

  it('файл из попапа: та же механика (tweb newMedia → onHelperCancel после цикла)', async () => {
    const { managers, result } = setup()
    openReply(result)
    act(() => { result.current.setPendingMedia({ files: [file()], asFile: true }) })
    await act(async () => { await result.current.sendPendingMedia('', true) })
    expect(result.current.reply).toBeNull()

    act(() => { result.current.send('следующее') })
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ replyToMsgId: null })
  })

  it('канал (REST-пост) плашку тоже гасит, хотя пакет туда не едет', () => {
    const { managers, result } = setup({ isChannel: true })
    openReply(result)
    act(() => { result.current.send('пост') })
    expect(managers.channels.post).toHaveBeenCalled()
    expect(result.current.reply).toBeNull()
  })
})

describe('useChatSend: секретный чат', () => {
  it('текст несёт ответ и тред (цитата — нет, см. secretManager.secretWireFields)', () => {
    const { managers, result } = setup({ chat: chat({ type: 'secret' } as Partial<Chat>), threadRootId: 3 })
    openReply(result, { quote: { text: 'вет', offset: 4 } })
    act(() => { result.current.send('шёпот') })
    expect(managers.secret.sendText.mock.calls[0][0]).toMatchObject({ replyToMsgId: ORIG, threadId: 3 })
    expect(result.current.reply).toBeNull()
  })

  it('медиа несёт тот же пакет', async () => {
    const { managers, result } = setup({ chat: chat({ type: 'secret' } as Partial<Chat>) })
    openReply(result)
    act(() => { result.current.setPendingMedia({ files: [file()], asFile: true }) })
    await act(async () => { await result.current.sendPendingMedia('', true) })
    expect(managers.secret.sendMedia.mock.calls[0][0]).toMatchObject({ replyToMsgId: ORIG })
  })
})
