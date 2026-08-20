// Вкладка «Звонки» (tweb/Telegram Calls): журнал звонков — агрегирует
// call-сообщения личных чатов (GET /calls). Строка: собеседник, направление
// (исходящий/входящий/пропущенный) и время; справа — кнопка перезвонить.
// Пропущенные входящие подсвечены красным (как в Telegram). Клик по строке
// открывает чат, клик по иконке трубки/камеры — новый звонок.
import { useMemo } from 'react'
import Text from '../shared/ui/Text'
import IconButton from '../shared/ui/IconButton'
import TgIcon from './TgIcon'
import Avatar from '../shared/ui/Avatar'
import { useMediaUrl } from '../core/hooks/useMediaUrl'
import { getPeerPhotoId } from '../core/peers/peer'
import { getUserTitle } from '../core/peers/getPeerTitle'
import { useCallsLog } from '../core/hooks/useCallsLog'
import { useNavLayer } from '../core/hooks/useNavLayer'
import { gradientFor } from '../core/dialogToChat'
import { messageDateISO } from '../core/messageToConvMsg'
import { cachedUser } from '../core/peerCache'
import { dayLabel, startOfDayMs } from '../core/format/dayLabel'
import { startOutgoing } from '../core/calls/callEngine'
import type { MyMessage } from '../core/models'
import { useT, useLang } from '../i18n'
import s from './CallsView.module.scss'

const hhmm = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function CallRow({ call, onOpen }: { call: MyMessage; onOpen: (peerId: PeerId) => void }) {
  const t = useT()
  // Собеседник приватного звонка — это САМ пир записи: его карточка приехала
  // вектором `users` того же ответа и лежит в зеркале.
  const peerId = call.peerId
  const peer = cachedUser(peerId)
  const photoId = peer?._ === 'user' ? getPeerPhotoId(peer.photo) : 0
  const name = getUserTitle(peer)
  const src = useMediaUrl(photoId || null)
  // Исход звонка — в САМОМ действии (`messageActionPhoneCall`), а не в JSON
  // внутри текста: «состоялся» от «отменён» отличает НАЛИЧИЕ длительности.
  const action = call._ === 'messageService' && call.action._ === 'messageActionPhoneCall' ? call.action : undefined
  const out = !!call.pFlags.out
  const date = messageDateISO(call.date)
  // Пропущенный входящий (не мы инициировали, не состоялся) — красным.
  const missed = !out && !action?.duration
  const startCall = (video: boolean) => (e: React.MouseEvent) => {
    e.stopPropagation()
    startOutgoing(
      { id: peerId, name, avatar: gradientFor(peerId), avatarText: name.charAt(0).toUpperCase(), photoId },
      video,
      peerId,
    )
  }
  return (
    <div className={s.row} onClick={() => onOpen(peerId)}>
      <Avatar background={gradientFor(peerId)} text={name.charAt(0).toUpperCase()} src={src} size={46} />
      <div className={s.rowText}>
        <Text noWrap size={16} color={missed ? '#ff595a' : 'var(--primary-text-color)'}>
          {name}
        </Text>
        <div className={s.sub}>
          {/* стрелка направления: исходящий — зелёная вверх-вправо, входящий/пропущенный — красная */}
          <TgIcon
            name="arrow_next"
            size={15}
            color={out ? '#4dcd5e' : '#ff595a'}
            style={{ transform: out ? 'rotate(-45deg)' : 'rotate(135deg)', flexShrink: 0 }}
          />
          <Text noWrap size={13.5} color="var(--secondary-text-color)">
            {(out ? t('Outgoing') : missed ? t('Missed') : t('Incoming')) + ' · ' + hhmm(date)}
          </Text>
        </div>
      </div>
      <IconButton onClick={startCall(false)} color="var(--primary-color)">
        <TgIcon name={action?.pFlags?.video ? 'videocamera' : 'phone'} size={22} />
      </IconButton>
    </div>
  )
}

export default function CallsView({ onBack, onOpenChat }: { onBack: () => void; onOpenChat: (peerId: PeerId) => void }) {
  const t = useT()
  const [lang] = useLang()
  useNavLayer(true, onBack) // Back закрывает экран «Звонки»
  const calls = useCallsLog()

  // Группировка по дням (Сегодня/Вчера/дата) — записи с бэка уже отсортированы
  // от новых к старым, поэтому дни идут по порядку.
  const groups = useMemo(() => {
    const out: { key: number; label: string; items: MyMessage[] }[] = []
    for (const c of calls ?? []) {
      const key = startOfDayMs(messageDateISO(c.date))
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(c)
      else out.push({ key, label: dayLabel(messageDateISO(c.date), lang), items: [c] })
    }
    return out
  }, [calls, lang])

  return (
    <div className={s.screen}>
      <div className={s.header}>
        <IconButton onClick={onBack} color="var(--secondary-text-color)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--primary-text-color)" className={s.title}>
          {t('Calls')}
        </Text>
      </div>

      <div className={s.list}>
        {calls != null && calls.length === 0 && (
          <div className={s.empty}>
            <TgIcon name="phone" size={48} color="var(--secondary-text-color)" />
            <Text size={15} color="var(--secondary-text-color)">{t('No recent calls')}</Text>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key}>
            <Text size={13} weight={600} color="var(--secondary-text-color)" className={s.dayLabel}>
              {g.label}
            </Text>
            {g.items.map((c) => (
              <CallRow key={c.id} call={c} onOpen={onOpenChat} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
