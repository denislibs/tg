// ВРЕМЕННО до 2C-25 — мост вместо `PopupElement.createPopup(PopupReactedList,
// message)` из tweb `src/components/chat/contextMenu.ts:1245-1251` (попап —
// `popups/reactedList.tsx`, 812502980). Solid-попап портирует задача 25 плана
// 2C; до неё список рисует наш React `ReactedUsersPopup`
// (`messages/ChatDialogs.tsx`), открытый функцией через `popupStore` (остров
// оверлеев). Задача 2C-25 заменяет вызов в `chat/contextMenu.ts` и удаляет этот
// файл: `git grep -n "ВРЕМЕННО до 2C-25"` → пусто.
//
// Список ОДИН на реакции и просмотры — порт
// `appMessagesManager.getMessageReactionsListAndReadParticipants`
// (tweb `appMessagesManager.ts:9037-9088`): оба запроса параллельно,
// упавший список просмотревших — пустой вектор, просмотревший, который уже
// отреагировал, вычёркивается, порядок — реагировавшие, следом просмотревшие.
//
// Чего мост не умеет (закроет 2C-25): `ReactedUsersPopup` позиционируемый, а не
// модальный — ему нужен якорь (точка клика по пункту меню).
import { createElement } from 'react'
import { openPopup } from '@stores/popupStore'
import { startClient } from '@/client/bootstrap'
import { getUserTitle } from '@core/peers/getPeerTitle'
import { getPeerPhotoId } from '@core/peers/peer'
import { canViewReactionsList } from '@core/reactions/messageReactions'
import type { ReactionUser } from '@core/managers/messages/reactionMethods'
import type { MyMessage } from '@core/models'

export default async function showReactedListPopup(message: MyMessage, at: { x: number, y: number }) {
  const { managers } = startClient()
  const { peerId, id: mid } = message
  // Право на список реагировавших — тот же терм, что у чипа (tweb
  // `chat/reactionContextMenu.ts:95-106`); без него остаются просмотревшие.
  const [users, viewerIds] = await Promise.all([
    canViewReactionsList(message.reactions, peerId) ?
      managers.messages.reactionUsers(peerId, mid) :
      Promise.resolve([] as ReactionUser[]),
    managers.messages.viewers(peerId, mid).catch(() => [] as number[]),
  ])

  const reactedIds = new Set(users.map((u) => u.user.id))
  const onlyViewers = viewerIds.filter((id) => !reactedIds.has(id))
  const viewerCards = onlyViewers.length ? await managers.peers.getUsers(onlyViewers) : []
  const rows = [
    ...users.map((u) => ({ name: getUserTitle(u.user), photoId: getPeerPhotoId(u.user.photo) || undefined, emoji: u.emoji })),
    ...viewerCards.map((u) => ({ name: getUserTitle(u), photoId: getPeerPhotoId(u.photo) || undefined })),
  ]

  // React-диалоги чата — по требованию, как в мосте пересылки
  const { ReactedUsersPopup } = await import('@components/messages/ChatDialogs')
  openPopup((p) => createElement(ReactedUsersPopup, {
    x: Math.min(at.x, window.innerWidth - 240),
    y: Math.min(at.y, window.innerHeight - 320),
    rows,
    onClose: p.destroy,
  }))
}
