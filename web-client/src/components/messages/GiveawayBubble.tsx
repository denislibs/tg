// Баббл розыгрыша (по мотивам tweb chat/giveaway.tsx): трофей + приз +
// участники + дата/обратный отсчёт + кнопка участия. Розыгрыш создаётся как
// сообщение типа 'giveaway'; участие и статус приходят live через
// giveaway_update. В отличие от tweb добавлены живой счётчик участников и
// обратный отсчёт до окончания (по требованию к фиче).
import { useEffect, useState } from 'react'
import Text from '../../shared/ui/Text'
import { useManagers } from '../../core/hooks/useManagers'
import { useMessagesStore } from '../../stores/messagesStore'
import { useChatsStore } from '../../stores/chatsStore'
import type { Giveaway } from '../../core/models'
import { useT } from '../../i18n'
import s from './GiveawayBubble.module.scss'

// countdown форматирует остаток до окончания розыгрыша в компактную строку.
function formatCountdown(ms: number, t: (k: string) => string): string {
  if (ms <= 0) return t('Ended')
  const sec = Math.floor(ms / 1000)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const ss = sec % 60
  if (d > 0) return `${d}${t('d')} ${h}${t('h')}`
  if (h > 0) return `${h}${t('h')} ${m}${t('m')}`
  if (m > 0) return `${m}${t('m')} ${ss}${t('s')}`
  return `${ss}${t('s')}`
}

export default function GiveawayBubble({ giveaway }: { giveaway: Giveaway }) {
  const t = useT()
  const managers = useManagers()
  const chatId = useChatsStore((st) => st.activeChatId) ?? 0
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const active = giveaway.status === 'active'
  const remaining = giveaway.untilDate - now

  // Тикер обратного отсчёта — только пока розыгрыш активен.
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  const prizeText = giveaway.prizeKind === 'stars'
    ? `${giveaway.stars} ${t('Stars')}`
    : `${t('Telegram Premium')} · ${giveaway.months} ${t('mo')}`

  const onParticipate = () => {
    if (busy) return
    setBusy(true)
    void managers.boosts
      .participateGiveaway(giveaway.id)
      .then((g) => useMessagesStore.getState().setGiveaway(chatId, g))
      .finally(() => setBusy(false))
  }

  return (
    <div className={s.giveaway}>
      <div className={s.sticker}>
        <span className={s.trophy}>🏆</span>
        <span className={s.counter}>x{giveaway.winnersCount}</span>
      </div>

      <div className={s.row}>
        <div className={s.rowTitle}>{t('Giveaway Prizes')}</div>
        <Text size={14} color="var(--b-text)" style={{ textAlign: 'center' }}>
          <b>{giveaway.winnersCount}</b> {prizeText}
        </Text>
      </div>

      <div className={s.row}>
        <div className={s.rowTitle}>{t('Participants')}</div>
        <Text size={14} color="var(--b-text)">{giveaway.participants}</Text>
      </div>

      <div className={s.row}>
        <div className={s.rowTitle}>{active ? t('Winners Selection Date') : t('Giveaway Ended')}</div>
        <Text size={14} weight={600} color="var(--tg-accent)">
          {active ? formatCountdown(remaining, t) : t('Winners selected')}
        </Text>
      </div>

      {!active && giveaway.iWon && (
        <div className={s.won}>🎉 {t('You won the giveaway!')}</div>
      )}

      {active && (
        giveaway.participating ? (
          <div className={s.participating}>✓ {t('You are participating')}</div>
        ) : (
          <button className={s.btn} disabled={busy} onClick={onParticipate}>
            {t('Participate')}
          </button>
        )
      )}
    </div>
  )
}
