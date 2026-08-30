// AutoDeleteMessages — глобальный таймер автоудаления (tweb
// autoDeleteMessages: UtyanDisappear, «Self-destruct timer», Off/1 день/
// 1 неделя/1 месяц + «Выбрать другой срок» попапом). Применяется к чатам,
// созданным после изменения (как в Telegram).
import type { LangPackKey } from '@/lang'
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
export function autoDeleteLabel(seconds: number, t: (key: LangPackKey) => string): string {
  if (seconds <= 0) return t('Off')
  const d = Math.round(seconds / DAY)
  if (d >= 360) return t('Duration.Years1')
  if (d >= 28) {
    const m = Math.round(d / 30)
    return m === 1 ? t('Duration.Months1') : `${m} ${t('Unit.MonthsSuffix')}`
  }
  if (d % 7 === 0) {
    const w = d / 7
    return w === 1 ? t('Duration.Weeks1') : `${w} ${t('Unit.WeeksSuffix')}`
  }
  return d === 1 ? t('Duration.Days1') : `${d} ${t('Unit.DaysSuffix')}`
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
    <SettingsScreen title="AutoDeleteMessages" onBack={onBack}>
      <LottieSticker name="UtyanDisappear" size={120} />
      <Section
        caption="AutoDeleteMessages.SectionTitle"
        footer="AutoDeleteMessages.SectionCaption"
      >
        <Row label="Off" selected={period === 0} onClick={() => save(0)} />
        <Row label="Duration.Days1" selected={period === DAY} onClick={() => save(DAY)} />
        <Row label="Duration.Weeks1" selected={period === 7 * DAY} onClick={() => save(7 * DAY)} />
        <Row label="Duration.Months1" selected={period === 30 * DAY} onClick={() => save(30 * DAY)} />
        {isCustom && <Row label={autoDeleteLabel(period, t)} translate={false} selected />}
        <Row
          icon={<TgIcon name="tools" size={24} />}
          label="AutoDeleteMessages.SetOtherTime"
          onClick={() => setCustomOpen(true)}
        />
      </Section>

      <Popup open={customOpen} title={t('AutoDeleteMessages.SetOtherTime')} onClose={() => setCustomOpen(false)}>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {CUSTOM.map((sec) => (
            <div
              key={sec}
              onClick={() => { save(sec); setCustomOpen(false) }}
              style={{ padding: '12px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
            >
              <Text size={15.5} color="var(--primary-text-color)" style={{ flex: 1 }}>
                {autoDeleteLabel(sec, t)}
              </Text>
              {period === sec && <TgIcon name="check" size={20} color="var(--primary-color)" />}
            </div>
          ))}
        </div>
      </Popup>
    </SettingsScreen>
  )
}
