// НАХОДКА РЕВЬЮ (Critical, финальный раунд Task 4 плана
// docs/superpowers/plans/2026-09-05-profile-card-solid.md): панель рисовала
// ДВЕ строки ссылки одновременно — React-фолбэк инвайт-ссылки
// (UserInfoPanel.tsx) и Solid-`Link` (peerProfile.solid.tsx) — потому что
// React-гейт `!chat.username` читал МЁРТВОЕ поле вью-модели (было `data.ts:
// 179`, снесено следующей находкой того же ревью вместе с единственным
// писателем): у поля был РОВНО ОДИН писатель (`App.tsx`, `draftChat` —
// ТОЛЬКО для приватного черновик-чата, `type: 'private'`) и ноль читателей
// для группы/канала — `core/dialogToChat.ts` его не выставляет вовсе, а этот
// гейт живёт под `(isGroup || isChannel)`, то есть адресует ДРУГОЙ вид чата,
// чем единственный писатель. Для группы/канала поле было пусто ВСЕГДА, и
// гейт был истинен ВСЕГДА. У публичного канала/группы с уже лениво созданной
// инвайт-ссылкой (`useGroupInfo.ts:142-151`, право `invite_links`) поэтому
// рисовались обе строки разом (эта + Solid-Link), с разными URL и двумя
// QR-кнопками.
//
// Фикс сводит источник истины к ОДНОМУ предикату — `isPublic`
// (`core/peers/predicates.ts:79`, порт `appChatsManager.isPublic`; до фикса
// был объявлен, но не имел ни одного вызывающего) над ОДНИМ зеркалом пиров
// (`core/peerCache.ts`): React читает `isPublicPeer(peerId)`
// (`UserInfoPanel.tsx`), Solid — `isPublic(context.peer)`
// (`peerProfile.solid.tsx::Link`) через `usePeer`/`stores/peers.solid.ts` —
// то же `cachedPeer`/`cachedChat`.
//
// Панель нерендерибельна в vitest целиком (портал, менеджеры, полдюжины
// сторов — то же основание, что у `UserInfoPanel.shell.test.ts`), поэтому пин
// разбит на два уровня: текстовый (гейт в реальном файле не откатился на
// мёртвое поле) + поведенческий (сам предикат над РЕАЛЬНЫМ зеркалом пиров
// действительно взаимоисключает фолбэк и Solid-Link, и — отдельным кейсом —
// воспроизводит старый баг на эмулированном дохлом поле).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPeerOps, cachedChat, isPublicPeer, resetPeerMirror } from '../core/peerCache'
import { isPublic } from '../core/peers/predicates'

const panel = readFileSync(join(__dirname, 'UserInfoPanel.tsx'), 'utf8')

/** Statement `const fallbackInviteUrl = ...` — от маркера до соседнего
 *  `const fallbackInviteShort` сразу под ним. Тернарник без вложенных фигурных
 *  скобок — балансовая экстракция соседних пинов файла здесь не нужна. */
function extractFallbackInviteUrlStatement(src: string): string {
  const start = src.indexOf('const fallbackInviteUrl =')
  if (start === -1) throw new Error('const fallbackInviteUrl = ... не найден')
  const end = src.indexOf('const fallbackInviteShort', start)
  if (end === -1) throw new Error('конец statement (маркер fallbackInviteShort) не найден')
  return src.slice(start, end)
}

describe('UserInfoPanel — гейт фолбэк-строки инвайт-ссылки', () => {
  it('не читает мёртвое chat.username — читает isPublicPeer(peerId), тот же предикат, что Solid-Link', () => {
    const stmt = extractFallbackInviteUrlStatement(panel)
    expect(stmt, 'мутация: вернулся дохлый гейт !chat.username').not.toMatch(/chat\.username/)
    expect(stmt).toMatch(/!isPublicPeer\(peerId\)/)
  })
})

describe('гейт фолбэка (React) и Solid-Link — взаимоисключающие для одного пира', () => {
  afterEach(() => resetPeerMirror())

  const CHANNEL_ID = 100 // peerKey (peer.ts:503) — знаковый ключ канала: -Math.abs(id)
  const peerId = -CHANNEL_ID

  function seedChannel(username: string | undefined) {
    applyPeerOps([
      {
        op: 'upsert',
        peers: [{
          _: 'channel', id: CHANNEL_ID, title: 'Канал', pFlags: { megagroup: true },
          photo: { _: 'chatPhotoEmpty' }, date: 0, username,
        }],
      },
    ])
  }

  it('публичный канал (username задан) + уже созданная инвайт-ссылка: фолбэк гасится, Solid-Link рисуется', () => {
    seedChannel('public')
    const inviteLinkExists = true // useGroupInfo.ts:142-151 создаёт ссылку лениво

    // React: буквально та же формула, что в UserInfoPanel.tsx (см. пин выше).
    const reactShowsFallback = !isPublicPeer(peerId) && inviteLinkExists
    // Solid: буквально та же формула, что в peerProfile.solid.tsx::Link.
    const solidShowsLink = isPublic(cachedChat(peerId))

    expect(solidShowsLink).toBe(true)
    expect(reactShowsFallback).toBe(false)
    expect(reactShowsFallback && solidShowsLink, 'обе строки не могут появиться одновременно').toBe(false)
  })

  it('приватный канал (username не задан) + инвайт-ссылка: фолбэк рисуется, Solid-Link — нет', () => {
    seedChannel(undefined)
    const inviteLinkExists = true

    const reactShowsFallback = !isPublicPeer(peerId) && inviteLinkExists
    const solidShowsLink = isPublic(cachedChat(peerId))

    expect(solidShowsLink).toBe(false)
    expect(reactShowsFallback).toBe(true)
    expect(reactShowsFallback && solidShowsLink).toBe(false)
  })

  it('репродукция старого бага: дохлое chat.username даёт ИСТИНА && ИСТИНА одновременно с Solid-Link', () => {
    seedChannel('public') // публичный канал — реальный username есть
    const inviteLinkExists = true
    // Симуляция СТАРОГО гейта: `chat.username` — поле вью-модели, у которого
    // для группы/канала не было ни писателя, ни читателя (см. докблок файла) —
    // в проде оно ровно undefined.
    const deadChatUsername: string | undefined = undefined
    const oldReactShowsFallback = !deadChatUsername && inviteLinkExists
    const solidShowsLink = isPublic(cachedChat(peerId))

    expect(oldReactShowsFallback).toBe(true)
    expect(solidShowsLink).toBe(true)
    expect(oldReactShowsFallback && solidShowsLink, 'старый гейт: обе строки рисовались разом — это и есть находка ревью').toBe(true)
  })
})
