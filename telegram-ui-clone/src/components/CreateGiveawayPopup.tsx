// Модалка создания розыгрыша — по мотивам tweb popups/boostsViaGifts.tsx:
// выбор приза (Telegram Premium / Telegram Stars), число победителей, срок
// подписки (для premium) или сумма звёзд, дата окончания (≤ 7 дней).
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import classNames from '../shared/lib/classNames'
import { useT } from '../i18n'
import type { CreateGiveawayArgs } from '../core/managers/boostsManager'
import s from './CreateGiveawayPopup.module.scss'

const MONTHS = [1, 3, 6, 12]
const WEEK_MS = 7 * 24 * 3600 * 1000

// значение по умолчанию для input[type=datetime-local] (now + 1 день, локальное).
function defaultEnd(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CreateGiveawayPopup({ onCreate, onClose }: {
  onCreate: (a: CreateGiveawayArgs) => void
  onClose: () => void
}) {
  const t = useT()
  const [kind, setKind] = useState<'premium' | 'stars'>('premium')
  const [winners, setWinners] = useState(10)
  const [months, setMonths] = useState(3)
  const [stars, setStars] = useState(100)
  const [end, setEnd] = useState(defaultEnd)

  const untilMs = new Date(end).getTime()
  const canCreate =
    winners >= 1 && winners <= 100 &&
    Number.isFinite(untilMs) && untilMs > Date.now() && untilMs <= Date.now() + WEEK_MS &&
    (kind === 'premium' ? months > 0 : stars > 0)

  const submit = () => {
    if (!canCreate) return
    onCreate({
      prizeKind: kind,
      months: kind === 'premium' ? months : 0,
      stars: kind === 'stars' ? stars : 0,
      winnersCount: winners,
      untilDate: untilMs,
    })
  }

  return (
    <Popup open title={t('New Giveaway')} onClose={onClose} width={420} action={{ label: t('Start Giveaway'), onClick: submit }}>
      <div className={s.body}>
        <Text size={13.5} weight={600} color="var(--tg-accent)" className={s.label}>{t('Prize')}</Text>
        <div className={s.types}>
          <div className={classNames(s.type, kind === 'premium' ? s.typeOn : '')} onClick={() => setKind('premium')}>
            {t('Telegram Premium')}
          </div>
          <div className={classNames(s.type, kind === 'stars' ? s.typeOn : '')} onClick={() => setKind('stars')}>
            {t('Telegram Stars')}
          </div>
        </div>

        {kind === 'premium' ? (
          <>
            <Text size={13.5} weight={600} color="var(--tg-accent)" className={s.label}>{t('Duration of premium subscriptions')}</Text>
            <div className={s.types}>
              {MONTHS.map((mo) => (
                <div key={mo} className={classNames(s.type, months === mo ? s.typeOn : '')} onClick={() => setMonths(mo)}>
                  {mo} {t('mo')}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <Text size={13.5} weight={600} color="var(--tg-accent)" className={s.label}>{t('Stars per winner')}</Text>
            <input className={s.input} type="number" min={1} value={stars}
              onChange={(e) => setStars(Math.max(1, Number(e.target.value) || 0))} />
          </>
        )}

        <Text size={13.5} weight={600} color="var(--tg-accent)" className={s.label}>{t('Quantity of prizes')}</Text>
        <input className={s.input} type="number" min={1} max={100} value={winners}
          onChange={(e) => setWinners(Math.min(100, Math.max(1, Number(e.target.value) || 0)))} />

        <Text size={13.5} weight={600} color="var(--tg-accent)" className={s.label}>{t('Date when giveaway ends')}</Text>
        <input className={s.input} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        <Text size={13} color="var(--tg-textSecondary)" style={{ padding: '2px 4px' }}>
          {t('Giveaway can last up to 7 days.')}
        </Text>
      </div>
    </Popup>
  )
}
