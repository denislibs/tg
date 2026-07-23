// Блок «Похожие каналы» под лентой канала. Порт tweb chat/similarChannels.tsx:
// карточка-плитка (аватар 60px + название в 2 строки + бейдж с числом
// подписчиков), горизонтальный скролл, заголовок с крестиком. Последняя плитка
// «+N» под Premium: не-премиум видит замок и попадает в PremiumModal; премиум
// видит все каналы инлайн. Скрытие крестиком запоминается per-channel.
import { useState } from 'react'
import UserAvatar from '../UserAvatar'
import TgIcon from '../TgIcon'
import PremiumModal from '../PremiumModal'
import { useManagers } from '../../core/hooks/useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { useSimilarChannels, isSimilarHidden, setSimilarHidden, type SimilarChannel } from '../../core/hooks/useSimilarChannels'
import { useT } from '../../i18n'
import s from './SimilarChannels.module.scss'

const DEFAULT_LIMIT = 10 // сколько плиток видит не-премиум (tweb recommended_channels_limit_default)

// Компактное число подписчиков (1234 → «1.2K», 2_500_000 → «2.5M») — как
// formatNumber(x, 1) в tweb.
function fmtCompact(n: number): string {
  if (n < 1000) return String(n)
  const unit = n < 1_000_000 ? 1000 : 1_000_000
  const v = n / unit
  const str = (v < 10 ? v.toFixed(1) : String(Math.round(v))).replace(/\.0$/, '')
  return str + (unit === 1000 ? 'K' : 'M')
}

function SimilarPeer({ chat, onClick }: { chat: SimilarChannel; onClick: () => void }) {
  return (
    <div className={s.channel} onClick={onClick}>
      <UserAvatar id={chat.id} name={chat.title} size={60} />
      <span className={s.badge}>
        <TgIcon name="newprivate_filled" size={8.5} />
        {fmtCompact(chat.memberCount || 1)}
      </span>
      <span className={s.name}>{chat.title}</span>
    </div>
  )
}

function MorePeer({ chat, more, premium, onClick }: { chat: SimilarChannel; more: number; premium: boolean; onClick: () => void }) {
  const t = useT()
  return (
    <div className={`${s.channel} ${s.isLast}`} onClick={onClick}>
      <div className={s.avatarStack}>
        <div className={s.stackFirst}>
          <UserAvatar id={chat.id} name={chat.title} size={60} />
        </div>
        <div className={s.stackMiddle} />
        <div className={s.stackLast} />
      </div>
      <span className={s.badge}>
        {`+${more}`}
        {!premium && <TgIcon name="premium_lock" size={9.5} />}
      </span>
      <span className={s.name}>{t('More Channels')}</span>
    </div>
  )
}

export default function SimilarChannels({ chatId, onOpen }: { chatId: number; onOpen: (chatId: number, username: string) => void }) {
  const t = useT()
  const managers = useManagers()
  const premium = useChatsStore((st) => !!st.me?.premium)
  const { chats, count } = useSimilarChannels({ isRealChat: true, isChannel: true, numericChatId: chatId, managers })
  const [hidden, setHidden] = useState(() => isSimilarHidden(chatId))
  const [premiumOpen, setPremiumOpen] = useState(false)

  if (hidden || chats.length === 0) return null

  const close = () => { setHidden(true); setSimilarHidden(chatId, true) }

  // Не-премиум: показываем DEFAULT_LIMIT плиток, последняя — «+N» с замком.
  // Премиум: все вернувшиеся каналы инлайн.
  const hasMore = !premium && count > DEFAULT_LIMIT
  const normal = hasMore ? chats.slice(0, DEFAULT_LIMIT - 1) : (premium ? chats : chats.slice(0, DEFAULT_LIMIT))
  const moreChat = hasMore ? chats[DEFAULT_LIMIT - 1] : undefined

  return (
    <div className={s.container}>
      <svg className={s.notch} width="19" height="7" viewBox="0 0 19 7" xmlns="http://www.w3.org/2000/svg">
        <path className={s.notchPath} d="M9.5 0C7.5 0 6 3 3.5 5.5C2 7 0 7 0 7H19C19 7 17 7 15.5 5.5C13 3 11.5 0 9.5 0Z" />
      </svg>
      <div className={s.header}>
        {t('Similar Channels')}
        <button className={s.close} onClick={close} aria-label={t('Close')}>
          <TgIcon name="close" size={20} />
        </button>
      </div>
      <div className={s.scroll}>
        <div className={s.listMargin} />
        <div className={s.list}>
          {normal.map((c) => (
            <SimilarPeer key={c.id} chat={c} onClick={() => onOpen(c.id, c.username)} />
          ))}
          {moreChat && (
            <MorePeer
              chat={moreChat}
              more={count - DEFAULT_LIMIT}
              premium={premium}
              onClick={() => (premium ? onOpen(moreChat.id, moreChat.username) : setPremiumOpen(true))}
            />
          )}
        </div>
        <div className={s.listMargin} />
      </div>
      <PremiumModal open={premiumOpen} onClose={() => setPremiumOpen(false)} />
    </div>
  )
}
