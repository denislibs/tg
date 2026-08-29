// ChatMsgActionPopups — попапы, управляемые стейтом useMessageActions
// (статистика/факт-чек поста, «кто отреагировал», пикер форварда, удаление).
// Они state-driven (открываются из хука, не императивно): большинство
// рендерится декларативно здесь же (JSX), а не через popupStore; удаление —
// исключение (раунд правок 3): `m.delIds` остаётся React-триггером, но сам
// попап — vanilla `PopupPeer` (`ChatDialogs.tsx::openDeleteMessageDialog`),
// открывается императивно из эффекта, см. ниже. Всего ~3 пропса — данные
// (диалоги) и t/managers берём из стора/контекста внутри.
//
// Меню сообщения здесь больше нет: его открывала React-лента, а её место занял
// ванильный порт (`components/chat/contextMenu.ts`), который рисует пункты сам
// и зовёт отсюда только действия.
import { lazy, Suspense, useEffect } from 'react'
import { useChatsStore } from '../../stores/chatsStore'
import { dialogToChat } from '../../core/dialogToChat'
import { peerTitle } from '../../core/peerCache'
import { isUser } from '../../core/peers/peerId'
import { useManagers } from '../../core/hooks/useManagers'
import type { useMessageActions } from '../../core/hooks/useMessageActions'
import FactCheckEditor from './FactCheckEditor'
import { openDeleteMessageDialog, ForwardPicker, ReactedUsersPopup } from '../messages/ChatDialogs'

const PostStats = lazy(() => import('../PostStats'))

type MsgActions = ReturnType<typeof useMessageActions>

export default function ChatMsgActionPopups({ msgActions, numericChatId }: {
  msgActions: MsgActions
  numericChatId: number
}) {
  const allDialogs = useChatsStore((s) => s.dialogs)
  const meId = useChatsStore((s) => s.meId)
  const managers = useManagers()
  const m = msgActions
  // Для delete-конфирма (tweb PopupDeleteMessages → PopupPeer peerId): тип чата и
  // first name собеседника подписывают чекбокс «Also delete for <имя>» /
  // «Delete for all members» — аватар чата (32) строит сам `PopupPeer` из
  // `peerId`+`managers` (раунд правок 3), React `<Avatar>` тут больше не нужен.
  const dialog = allDialogs.find((d) => d.peerId === numericChatId)
  const dialogChat = dialog ? dialogToChat(dialog, meId) : undefined

  // Delete confirmation — vanilla-попап (раунд правок 3, `ChatDialogs.tsx`
  // `openDeleteMessageDialog`): `m.delIds` остаётся React-состоянием-триггером
  // (тот же `useMessageActions` хук, тот же `doDelete`/`closeDelete` — `Chat.tsx`
  // оборачивает их, чтобы заодно закрыть медиавьювер, если удаление начато из
  // него), но открывает попап больше не JSX-рендер, а прямой императивный вызов.
  useEffect(() => {
    if (!m.delIds) return
    const popup = openDeleteMessageDialog({
      peerId: m.delIds.peerId,
      managers,
      canRevoke: m.delIds.canRevoke,
      count: m.delIds.ids.length,
      chatType: dialogChat?.type,
      peerFirstName: dialog && isUser(dialog.peerId) ? peerTitle(dialog.peerId, { onlyFirstName: true }) : undefined,
      onDeleteForEveryone: () => m.doDelete(true),
      onDeleteForMe: () => m.doDelete(false),
      onClose: m.closeDelete,
    })
    // Владелец сам снимает то, что создал (правило шва, web-client/CLAUDE.md,
    // тот же приём, что `ConfirmDialog.tsx`): `Chat` размонтируется по `key`
    // при смене чата (список — не через popupStore/clearPopups, поэтому без
    // этого cleanup конфирм СТАРОГО чата висел бы поверх НОВОГО и всё ещё
    // удалял бы из него — найдено финальным ревью solid-wave-1).
    return () => popup.forceHide()
    // попап открывается один раз на новый m.delIds (свежий объект от
    // openDeleteFor, задача 3), а не на каждый рендер — остальные поля читаются
    // из актуального замыкания эффекта на момент срабатывания.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.delIds])

  return (
    <>
      {/* Статистика поста канала (slide-in сабвью, tweb messageStatistics) */}
      <Suspense fallback={null}>
        {m.postStats && (
          <PostStats chatId={numericChatId} msgId={m.postStats.msgId} onBack={m.closePostStats} />
        )}
      </Suspense>

      {/* Редактор «проверки фактов» (канал, автор/админ) */}
      {m.factCheckEdit && (
        <FactCheckEditor initial={m.factCheckEdit.initial} onClose={m.closeFactCheckEditor} onSubmit={m.submitFactCheck} />
      )}

      {/* Кто отреагировал (long-press/правый клик по чипу реакции) */}
      {m.reacted && (
        <ReactedUsersPopup x={m.reacted.x} y={m.reacted.y} rows={m.reacted.rows} onClose={m.closeReacted} />
      )}

      {/* Forward target picker */}
      {m.forwardIds != null && (
        <ForwardPicker dialogs={allDialogs} onPick={m.doForward} onClose={m.closeForward} />
      )}
    </>
  )
}
