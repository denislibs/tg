// Вкладка «Звонки» (tweb/Telegram Calls): журнал звонков — агрегирует
// call-сообщения личных чатов (GET /calls). Строка: собеседник, направление
// (исходящий/входящий/пропущенный) и время; справа — кнопка перезвонить.
// Пропущенные входящие подсвечены красным (как в Telegram). Клик по строке
// открывает чат, клик по иконке трубки/камеры — новый звонок.
import { useMemo } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import { motion } from 'framer-motion'
import TgIcon from './TgIcon'
import { slideInRight } from '../motion'
import Avatar from '../shared/ui/Avatar'
import { useAvatarSrc } from './useAvatarSrc'
import { useCallsLog } from '../core/hooks/useCallsLog'
import { useNavLayer } from '../core/hooks/useNavLayer'
import { gradientFor } from '../core/dialogToChat'
import { parseCallLog } from '../core/messageToConvMsg'
import { dayLabel, startOfDayMs } from '../core/format/dayLabel'
import { startOutgoing } from '../core/calls/callEngine'
import type { CallLogEntry } from '../core/managers/callsManager'
import { useT, useLang } from '../i18n'
import s from './CallsView.module.scss'

const hhmm = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function CallRow({ call, onOpen }: { call: CallLogEntry; onOpen: (chatId: number) => void }) {
  const t = useT()
  const src = useAvatarSrc(call.peerAvatar || undefined)
  const log = parseCallLog(call.text)
  // Пропущенный входящий (не мы инициировали, не состоялся) — красным.
  const missed = !call.out && log.reason !== 'ok'
  const startCall = (video: boolean) => (e: React.MouseEvent) => {
    e.stopPropagation()
    startOutgoing(
      { id: call.peerId, name: call.peerName, avatar: gradientFor(call.peerId), avatarText: call.peerName.charAt(0).toUpperCase(), avatarUrl: call.peerAvatar || undefined },
      video,
      call.chatId,
    )
  }
  return (
    <div className={s.row} onClick={() => onOpen(call.chatId)}>
      <Avatar background={gradientFor(call.peerId)} text={call.peerName.charAt(0).toUpperCase()} src={src} size={46} />
      <div className={s.rowText}>
        <Text noWrap size={16} color={missed ? '#ff595a' : 'var(--tg-textPrimary)'}>
          {call.peerName}
        </Text>
        <div className={s.sub}>
          {/* стрелка направления: исходящий — зелёная вверх-вправо, входящий/пропущенный — красная */}
          <TgIcon
            name="arrow_next"
            size={15}
            color={call.out ? '#4dcd5e' : '#ff595a'}
            style={{ transform: call.out ? 'rotate(-45deg)' : 'rotate(135deg)', flexShrink: 0 }}
          />
          <Text noWrap size={13.5} color="var(--tg-textSecondary)">
            {(call.out ? t('Outgoing') : missed ? t('Missed') : t('Incoming')) + ' · ' + hhmm(call.date)}
          </Text>
        </div>
      </div>
      <IconButton onClick={startCall(false)} color="var(--tg-accent)">
        <TgIcon name={log.video ? 'videocamera' : 'phone'} size={22} />
      </IconButton>
    </div>
  )
}

export default function CallsView({ onBack, onOpenChat }: { onBack: () => void; onOpenChat: (chatId: number) => void }) {
  const t = useT()
  const [lang] = useLang()
  useNavLayer(true, onBack) // Back закрывает экран «Звонки»
  const calls = useCallsLog()

  // Группировка по дням (Сегодня/Вчера/дата) — записи с бэка уже отсортированы
  // от новых к старым, поэтому дни идут по порядку.
  const groups = useMemo(() => {
    const out: { key: number; label: string; items: CallLogEntry[] }[] = []
    for (const c of calls ?? []) {
      const key = startOfDayMs(c.date)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(c)
      else out.push({ key, label: dayLabel(c.date, lang), items: [c] })
    }
    return out
  }, [calls, lang])

  return (
    <motion.div
      variants={slideInRight}
      initial="initial"
      animate="animate"
      exit="exit"
      style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'var(--tg-sidebarBg)', display: 'flex', flexDirection: 'column' }}
    >
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--tg-textSecondary)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--tg-textPrimary)" className={s.title}>
          {t('Calls')}
        </Text>
      </div>

      <div className={s.list}>
        {calls != null && calls.length === 0 && (
          <div className={s.empty}>
            <TgIcon name="phone" size={48} color="var(--tg-textFaint)" />
            <Text size={15} color="var(--tg-textSecondary)">{t('No recent calls')}</Text>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key}>
            <Text size={13} weight={600} color="var(--tg-textSecondary)" className={s.dayLabel}>
              {g.label}
            </Text>
            {g.items.map((c) => (
              <CallRow key={c.id} call={c} onOpen={onOpenChat} />
            ))}
          </div>
        ))}
      </div>
    </motion.div>
  )
}
