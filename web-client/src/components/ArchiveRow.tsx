// Ряд «Архив» — ЗАКРЕПЛЁННЫЙ элемент виртуального списка чатов (порт tweb
// `components/archiveDialog.tsx`). Ключевое: у него РОВНО тот же набор классов
// строки, что и у обычного диалога (`archiveDialog.tsx:46` —
// `props.element.classList.add('row', 'no-wrap', 'row-with-padding',
// 'row-clickable', 'hover-effect', 'rp', 'chatlist-chat', 'chatlist-chat-bigger',
// 'row-big')`), поэтому геометрия ряда (72px, отступ под аватар, типографика)
// приезжает из тех же партиалов, что и у `ChatListItem`, а не задаётся своя.
// Дети — 1:1 из оригинала: аватар, `.row-row.row-title-row`,
// `.row-row.row-subtitle-row` с бейджем суммарного непрочитанного.
//
// Не портировано: сегменты историй вокруг аватара (`ArchiveAvatar` →
// `StoriesSegments`) — у архива историй нет; жирность имён считается по
// `Chat.unread` из зеркала, а не отдельным RPC `isDialogUnread` на каждого пира.
import { Fragment, memo, type Ref } from 'react'
import classNames from '../shared/lib/classNames'
import Badge from '../shared/ui/Badge'
import { useRipple } from '../shared/ui/Ripple/useRipple'
import TgIcon from './TgIcon'
import type { Chat } from '../data'
import { useT } from '../i18n'
import s from './ArchiveRow.module.scss'

/** `archiveDialog.tsx:28-29` — до 10 имён, каждое обрезается до 20 символов. */
const LIMIT = 10
const LIMIT_SYMBOLS = 20

function ArchiveRow({ chats, onOpen, ref }: {
  chats: Chat[]
  onOpen: () => void
  /**
   * Корневой узел ряда — виртуальному списку (позиционирующий класс + `top`),
   * как и у `ChatListItem`. Ссылка обязана быть СТАБИЛЬНОЙ.
   */
  ref?: Ref<HTMLDivElement>
}) {
  const t = useT()
  const { onPointerDown, ripple } = useRipple()
  const unread = chats.reduce((sum, c) => sum + (c.unread ?? 0), 0)
  const names = chats.slice(0, LIMIT).map((c) => ({
    id: c.id,
    name: c.name.length > LIMIT_SYMBOLS ? c.name.slice(0, LIMIT_SYMBOLS) + '…' : c.name,
    unread: !!c.unread,
  }))

  return (
    <div
      ref={ref}
      className={classNames(
        'row', 'no-wrap', 'row-with-padding', 'row-clickable', 'hover-effect', 'rp',
        'chatlist-chat', 'chatlist-chat-bigger', 'row-big',
        s.row,
      )}
      onClick={onOpen}
      onPointerDown={onPointerDown}
    >
      {ripple}

      {/* archiveDialog.tsx:414-419 — слот аватара обычного ряда + градиентный круг */}
      <div className={classNames('row-media', 'row-media-bigger', 'dialog-avatar', s.media)}>
        <div className={s.mediaContent}>
          <TgIcon name="archive" size={28} color="#fff" />
        </div>
      </div>

      <div className={classNames('row-row', 'row-title-row')}>
        <span className={classNames('i18n', s.title)}>{t('Archived Chats')}</span>
      </div>

      <div className={classNames('row-row', 'row-subtitle-row')}>
        <div className={s.subtitle}>
          {/* Запятая — СИБЛИНГ имени, а не его часть (archiveDialog.tsx:76-79):
              иначе разделитель наследовал бы жирность непрочитанного. */}
          {names.map((n, i) => (
            <Fragment key={n.id}>
              {i > 0 && ', '}
              <span className={n.unread ? s.unreadPeerTitle : undefined}>{n.name}</span>
            </Fragment>
          ))}
        </div>
        {unread > 0 && <Badge muted className={s.unreadBadge}>{unread}</Badge>}
      </div>
    </div>
  )
}

export default memo(ArchiveRow)
