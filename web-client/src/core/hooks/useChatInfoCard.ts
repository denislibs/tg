// src/core/hooks/useChatInfoCard.ts
// View-model шапки настоящей группы/канала (вынесено из Chat): грузит ПОЛНУЮ
// карточку чата, для групп — снимок участников (засевая их присутствие в стор,
// единственный источник), и выводит права на запись, обсуждения и живой счётчик
// онлайна.
//
// ── Что изменилось со шагом D2.5 ────────────────────────────────────────────
// Вопросы «какой это чат» и «что мне можно» больше не задаются плоской карточке
// (`type`/`my_role`/`my_rights`/`default_permissions` с провода исчезли): вид
// чата — выбор конструктора (`core/peers/predicates.ts`), права — `pFlags` и
// `admin_rights`/`default_banned_rights` (`core/peers/rights.ts`).
//
// Кэша краткой карточки здесь БОЛЬШЕ НЕТ. Конструктор `channel` живёт в зеркале
// пиров (`core/peerCache.ts`, наполняет его `peers.saveApiPeers` из той же
// ручки), читается синхронно на первом же рендере и обновляется кадром
// `chat_update` сам. Свой второй кэш того же факта был бы вторым зеркалом
// realtime-данных. Кэшируется только ПОЛНАЯ форма — ровно как в оригинале
// (`appProfileManager.chatsFull` рядом с `appChatsManager.chats`).
import { useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import { usePeers } from './usePeers'
import { useChatsStore } from '../../stores/chatsStore'
import type { ChatMember, ChatCard } from '../managers/groupsManager'
import type { ChannelFull, Chat } from '../peers/peer'
import { getLinkedChatPeerId, isUserStatusOnline } from '../peers/peer'
import { cachedChat } from '../peerCache'
import { isUser } from '../peers/peerId'
import { saveChatFull } from '../chatFullCache'
import { isMegagroup } from '../peers/predicates'
import { hasRights } from '../peers/rights'

/** Полная карточка + поля уровня ответа (всё, чего нет в конструкторе `channel`).
 *  Прежнее плоское `muted` отсюда ушло: заглушённость это
 *  `channelFull.notify_settings`, параметр САМОЙ схемы, и мьют в нём выражен
 *  сроком (решение Р4). Читателей у поля не было ни одного — оно только
 *  хранилось. */
interface FullCard {
  fullChat: ChannelFull
}

// Полные карточки уже открывавшихся чатов. Повторный вход отдаёт их СИНХРОННО,
// на первом же рендере: без этого футер канала успевал показать плашку «нельзя
// писать» и вернуть строку ввода, когда карточка приезжала, — то самое дёрганье
// композера при переходе в канал из сайдбара. Сеть при этом ходит как раньше,
// но её ответ уже ничего не двигает.
//
// Порт `appProfileManager.chatsFull` (там же и TTL — `PEER_FULL_TTL`, который у
// нас пока не заведён: инвалидация приходит кадром `chat_update`).
//
// Сам конструктор `channelFull` при этом уезжает ЕЩЁ и в `core/chatFullCache.ts`
// — общее зеркало полных карточек. Здесь он лежит ради СИНХРОННОГО первого
// рендера (см. выше), а зеркало обслуживает вне-экранных читателей: тему
// оформления (`theme_emoticon`) читают обои шелла, и кадр `chat_theme_update`
// патчит именно зеркало.
const fullCache = new Map<PeerId, FullCard>()

/**
 * Сброс кэша при смене аккаунта — зовёт `resetAccountStateInMemory`
 * (useAuthGate, обработчик rt:logging_out): карточки прошлого аккаунта чужие, а
 * cache-first-показ выше отдал бы их следующему.
 */
export function resetChatCardCache(): void {
  fullCache.clear()
}

interface InfoManagers {
  groups: {
    card(peerId: PeerId): Promise<ChatCard | null>
    members(peerId: PeerId): Promise<ChatMember[]>
  }
}

export interface ChatInfoCard {
  /** полная форма (`channelFull`) + `creatorId`; null — ещё не загружена */
  full: FullCard | null
  /** краткая форма из зеркала пиров: вид чата и права зрителя. Единственный
   *  источник ответов «канал/супергруппа» и «что мне можно». */
  chat: Chat | undefined
  /**
   * Известны ли права на запись. Для канала до приезда карточки это третье
   * состояние — «неизвестно», а не «нельзя»: вывести из него плашку значит
   * показать её всем, включая владельца канала (см. `canType` ниже).
   */
  permissionsKnown: boolean
  /** Канал: писать могут только постящие (creator / post_messages); группы и личка — всегда. */
  canType: boolean
  /** Может ли зритель вообще писать (иначе — плашка вместо композера). */
  canSendText: boolean
  /** Может ли зритель отправлять медиа/голосовые/вложения. */
  canSendMedia: boolean
  discussionPeerId: PeerId
  /** Live count of online group members (derived from chatsStore.presence). */
  onlineCount: number
}

export function useChatInfoCard(args: {
  isRealChat: boolean
  isChannel: boolean
  numericChatId: number
}): ChatInfoCard {
  const { isRealChat, isChannel, numericChatId } = args
  const managers: InfoManagers = useManagers()
  // Загруженная полная карточка хранится ВМЕСТЕ с чатом, которому принадлежит.
  // Сброс эффектом (`setFull(null)`) для этого не годится: на первом рендере
  // после смены чата состояние ещё от прошлого.
  const [loaded, setLoaded] = useState<{ peerId: PeerId; full: FullCard } | null>(null)
  const memberIds = useRef<Set<number>>(new Set())
  // Online status is single-sourced from chatsStore.presence (fed by realtimeBridge);
  // we seed members' presence on load and derive the count below — no local listener.
  const setPresence = useChatsStore((s) => s.setPresence)

  // Краткая форма — из зеркала пиров. `usePeers` объявляет пробел зеркалу и
  // подписывает хук на его движение: карточка, приехавшая ответом `card()` или
  // кадром `chat_update`, пере-рендерит шапку сама.
  usePeers(isRealChat ? [numericChatId] : [])
  const chat = isRealChat ? cachedChat(numericChatId) : undefined

  const full = loaded?.peerId === numericChatId ? loaded.full : fullCache.get(numericChatId) ?? null

  // Fetch the card (заодно кладёт конструктор `channel` в зеркало пиров) и, для
  // групп, снимок участников (сеет memberIds + начальный онлайн).
  useEffect(() => {
    memberIds.current = new Set()
    if (!isRealChat) return
    let alive = true
    void managers.groups.card(numericChatId).then((c) => {
      if (!alive || !c) return
      const next: FullCard = { fullChat: c.fullChat }
      fullCache.set(numericChatId, next)
      // Полная карточка — в общее зеркало: её тема нужна и вне этого экрана
      // (колонка чата и обои шелла), а второго загрузчика карточки чата нет.
      saveChatFull(numericChatId, c.fullChat)
      setLoaded({ peerId: numericChatId, full: next })
      if (isMegagroup(c.chat)) {
        void managers.groups.members(numericChatId).then((mem) => {
          if (!alive) return
          memberIds.current = new Set(mem.map((m) => m.userId))
          // Сид присутствия участников в стор (единственный источник). Статус —
          // ЦЕЛЫЙ конструктор `UserStatus`, а не пара «онлайн + время»: склеивать
          // его с уже лежащим («сохранить прежний lastSeen») теперь не нужно и
          // нечем — вариант приходит целиком. Статуса нет в ответе (правило
          // приватности не пустило) — не трогаем лежащее вовсе.
          for (const m of mem) if (m.status) setPresence({ _: 'updateUserStatus', user_id: m.userId, status: m.status })
        })
      }
    })
    return () => { alive = false }
  }, [isRealChat, numericChatId, managers, setPresence])

  // `linked_chat_id` конструктора — СЫРОЙ положительный id чата; знаковый ключ
  // из него делает `getLinkedChatPeerId`, единственное место с этим переходом.
  const discussionPeerId = getLinkedChatPeerId(full?.fullChat)
  // Вещательный канал: писать может тот, у кого есть `post_messages` (создателю
  // `hasRights` отвечает «да» на всё сразу — порт, `pFlags.creator`).
  const canPostChannel = hasRights(chat, 'post_messages')
  const canType = !isChannel || canPostChannel
  // Карточка не грузится вовсе (не «настоящий» чат — тред/черновик) — там прав
  // и не будет, поведение прежнее; ждать надо только канал с картой в полёте.
  //
  // Признак «карточка приехала» — ПОЛНАЯ форма, а не наличие краткой в зеркале:
  // обе приходят одним ответом (`saveApiPeers` объявляет краткую до того, как
  // ответ дойдёт до вызывающего), но чистятся они разными руками — свой кэш
  // гасит `resetChatCardCache`, зеркало гасит проектор. Один признак вместо
  // двух не даёт состояния «полная есть, краткой нет», в котором `hasRights`
  // молча ответил бы «нельзя» и вернул бы ту самую плашку.
  const permissionsKnown = !isChannel || !isRealChat || full !== null

  // Права обычного участника — `default_banned_rights` (⚠ ЗАПРЕТЫ, не
  // разрешения). До приезда карточки чата — оптимистично «можно», чтобы композер
  // не мигал заблокированным (`hasRights` без карточки отвечает «нельзя»,
  // поэтому третье состояние выражено здесь явно).
  //
  // ЛИЧКА СПРАШИВАЕТСЯ ОТДЕЛЬНО, и это не оптимизация. У оригинала ветвление по
  // ВИДУ ПИРА: `canSendToPeer` (appMessagesManager.ts:8851-8863) у чата зовёт
  // `hasRights(chatId, …)`, а у пользователя — `canSendToUser(peerId)`, то есть
  // СОВСЕМ ДРУГОЙ вопрос (удалён/заблокирован), к правам чата отношения не
  // имеющий. У личного диалога объекта `Chat` не существует вовсе, поэтому
  // `hasRights(undefined, …)` отвечает «нельзя» — и композер закрывался плашкой
  // «Без звука», едва приезжала карточка. Ловилось это только живьём: в
  // «Избранном» писать было нельзя совсем.
  //
  // `canSendToUser` (удалён/заблокирован) не портирован — предмета нет: своего
  // признака блокировки на клиенте не заведено. Пока его нет, личке отвечаем
  // «можно», как оригинал отвечает обычному собеседнику.
  const canSendToUser = isUser(numericChatId)
  const canSendText = isChannel ? canPostChannel : canSendToUser || full === null || hasRights(chat, 'send_messages')
  const canSendMedia = isChannel ? canPostChannel : canSendToUser || full === null || hasRights(chat, 'send_media')

  // Count members currently online. Re-renders only when the number changes
  // (presence frames for non-members don't touch it).
  const onlineCount = useChatsStore((s) => {
    let n = 0
    // «Онлайн» — это `userStatusOnline`, У КОТОРОГО ЕЩЁ НЕ ИСТЁК `expires`
    // (порт `appUsersManager.isUserOnline`). Прежний булев `online` срока
    // годности не имел, и потерянный кадр держал человека в счётчике вечно.
    const now = Math.floor(Date.now() / 1000)
    for (const id of memberIds.current) if (isUserStatusOnline(s.presence[id], now)) n++
    return n
  })

  return { full, chat, permissionsKnown, canType, canSendText, canSendMedia, discussionPeerId, onlineCount }
}
