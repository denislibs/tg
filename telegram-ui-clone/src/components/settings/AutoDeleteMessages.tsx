// AutoDeleteMessages — глобальный таймер автоудаления (tweb
// autoDeleteMessages: UtyanDisappear, «Self-destruct timer», Off/1 день/
// 1 неделя/1 месяц + «Выбрать другой срок» попапом). Применяется к чатам,
// созданным после изменения (как в Telegram).
import { useEffect, useState } from 'react'
import LottieSticker from '../LottieSticker'
import TgIcon from '../TgIcon'
import Popup from '../../shared/ui/Popup'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { SettingsScreen, Section, Row } from './kit'

const DAY = 86400

// Подпись периода (и для сабтайтла в разделе конфиденциальности).
export function autoDeleteLabel(seconds: number, t: (s: string) => string): string {
  if (seconds <= 0) return t('Off')
  const d = Math.round(seconds / DAY)
  if (d >= 360) return t('1 year')
  if (d >= 28) {
    const m = Math.round(d / 30)
    return m === 1 ? t('1 month') : `${m} ${t('months')}`
  }
  if (d % 7 === 0) {
    const w = d / 7
    return w === 1 ? t('1 week') : `${w} ${t('weeks')}`
  }
  return d === 1 ? t('1 day') : `${d} ${t('days')}`
}

// tweb customTimeOptions: 1–6 дней, 1–3 недели, 1–11 месяцев, 1 год.
const CUSTOM: number[] = [
  ...[1, 2, 3, 4, 5, 6].map((d) => d * DAY),
  ...[1, 2, 3].map((w) => w * 7 * DAY),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((m) => m * 30 * DAY),
  365 * DAY,
]

const PRESETS = [0, DAY, 7 * DAY, 30 * DAY]

export default function AutoDeleteMessages({ onBack }: { onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const [period, setPeriod] = useState(0)
  const [customOpen, setCustomOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void managers.privacy.autoDelete().then((p) => {
      if (alive) setPeriod(p)
    }).catch(() => {})
    return () => { alive = false }
  }, [managers])

  const save = (p: number) => {
    setPeriod(p) // оптимистично
    managers.privacy.setAutoDelete(p).catch(() =>
      managers.privacy.autoDelete().then(setPeriod).catch(() => {}))
  }

  const isCustom = period > 0 && !PRESETS.includes(period)

  return (
    <SettingsScreen title="Auto-Delete Messages" onBack={onBack}>
      <LottieSticker name="UtyanDisappear" size={120} />
      <Section
        caption="Self-destruct timer"
        footer="If enabled, all new messages in chats you start will be automatically deleted for everyone at some point after they have been sent. Auto-delete in your previously created chats is enabled separately."
      >
        <Row label="Off" selected={period === 0} onClick={() => save(0)} />
        <Row label="1 day" selected={period === DAY} onClick={() => save(DAY)} />
        <Row label="1 week" selected={period === 7 * DAY} onClick={() => save(7 * DAY)} />
        <Row label="1 month" selected={period === 30 * DAY} onClick={() => save(30 * DAY)} />
        {isCustom && <Row label={autoDeleteLabel(period, t)} translate={false} selected />}
        <Row
          icon={<TgIcon name="tools" size={24} />}
          label="Set other time"
          onClick={() => setCustomOpen(true)}
        />
      </Section>

      <Popup open={customOpen} title={t('Set other time')} onClose={() => setCustomOpen(false)}>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {CUSTOM.map((sec) => (
            <div
              key={sec}
              onClick={() => { save(sec); setCustomOpen(false) }}
              style={{ padding: '12px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
            >
              <Text size={15.5} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
                {autoDeleteLabel(sec, t)}
              </Text>
              {period === sec && <TgIcon name="check" size={20} color="var(--tg-accent)" />}
            </div>
          ))}
        </div>
      </Popup>
    </SettingsScreen>
  )
}
