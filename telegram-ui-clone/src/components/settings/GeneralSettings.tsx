import { useState, type CSSProperties } from 'react'
import { AnimatePresence } from 'framer-motion'
import Text from '../../shared/ui/Text'
import Slider from '../../shared/ui/Slider'
import TgIcon from '../TgIcon'
import patternUrl from '../../assets/pattern.svg'
import { useT } from '../../i18n'
import { useSettings } from '../../settings'
import { type ThemeChoice, type ThemePreset } from '../../theme'
import { SettingsScreen, Section, Row } from './kit'
import ChatWallpaper from './ChatWallpaper'
import PowerSaving from './PowerSaving'
import s from './GeneralSettings.module.scss'

const THEME_CARDS: { preset: ThemePreset; emoji: string; colors: [string, string, string, string]; accent: string }[] = [
  { preset: 'classic', emoji: '🏠', colors: ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'], accent: '#7d63e8' },
  { preset: 'day', emoji: '🐤', colors: ['#dbddbb', '#6ba587', '#d5d88d', '#88b884'], accent: '#3390ec' },
  { preset: 'night', emoji: '⛄', colors: ['#fec496', '#dd6cb9', '#962fbf', '#4f5bd5'], accent: '#8774e1' },
  { preset: 'dark', emoji: '💎', colors: ['#4a5a6a', '#2e3a48', '#3a4654', '#28323e'], accent: '#5ea7e8' },
]

const THEME_RADIOS: { choice: ThemeChoice; label: string }[] = [
  { choice: 'classic', label: 'Classic' },
  { choice: 'night', label: 'Night' },
  { choice: 'day', label: 'Day' },
  { choice: 'dark', label: 'Tinted' },
  { choice: 'system', label: 'System' },
]

function RadioRow({
  label,
  sublabel,
  selected,
  onClick,
}: {
  label: string
  sublabel?: string
  selected: boolean
  onClick: () => void
}) {
  const t = useT()
  return (
    <div className={s.radioRow} onClick={onClick}>
      {selected ? (
        <TgIcon name="radioon" color="var(--tg-accent)" />
      ) : (
        <TgIcon name="radiooff" color="var(--tg-textFaint)" />
      )}
      <div>
        <Text size={16} color="var(--tg-textPrimary)">{t(label)}</Text>
        {sublabel && <Text size={13} color="var(--tg-textSecondary)">{sublabel}</Text>}
      </div>
    </div>
  )
}

export default function GeneralSettings({ onBack }: { onBack: () => void }) {
  const t = useT()
  const { textSize, timeFormat, themeChoice, update } = useSettings()
  const [dedicated, setDedicated] = useState<'wallpaper' | 'power' | null>(null)

  return (
    <SettingsScreen title="General Settings" onBack={onBack}>
      {/* Settings: text size + wallpaper + power saving */}
      <Section caption="Settings">
        <div className={s.textSize}>
          <div className={s.textSizeTop}>
            <Text size={16} color="var(--tg-textPrimary)">{t('Message Text Size')}</Text>
            <Text size={16} color="var(--tg-textFaint)">{textSize}</Text>
          </div>
          <Slider value={textSize} min={12} max={24} step={1} onChange={(v) => update({ textSize: v })} className={s.slider} />
        </div>
        <Row
          icon={<TgIcon name="image" size={24} />}
          label="Chat Background"
          chevron
          onClick={() => setDedicated('wallpaper')}
        />
        <Row
          icon={<TgIcon name="animations" size={24} />}
          label="Power Saving"
          value={t('Disabled')}
          onClick={() => setDedicated('power')}
        />
      </Section>

      {/* Color theme */}
      <Section caption="Color Theme">
        <div className={s.themeGrid}>
          {THEME_CARDS.map((c) => {
            const selected = themeChoice === c.preset
            return (
              <div
                key={c.preset}
                className={s.themeCard}
                data-selected={selected || undefined}
                onClick={() => update({ themeChoice: c.preset })}
                style={{ '--card-accent': c.accent } as CSSProperties}
              >
                <div
                  className={s.themeInner}
                  style={{ background: `linear-gradient(150deg, ${c.colors[0]}, ${c.colors[1]}, ${c.colors[2]}, ${c.colors[3]})` }}
                >
                  <div className={s.pattern} style={{ backgroundImage: `url("${patternUrl}")` }} />
                  {/* incoming + outgoing mini bubbles */}
                  <div className={s.bubbles}>
                    <div className={s.bubbleIn} />
                    <div className={s.bubbleOut} style={{ background: c.accent }} />
                  </div>
                  <Text size={16} className={s.emoji}>{c.emoji}</Text>
                </div>
              </div>
            )
          })}
        </div>
        {THEME_RADIOS.map((r) => (
          <RadioRow
            key={r.choice}
            label={r.label}
            selected={themeChoice === r.choice}
            onClick={() => update({ themeChoice: r.choice })}
          />
        ))}
      </Section>

      {/* Time format */}
      <Section caption="Time Format">
        <RadioRow
          label="12-hour"
          sublabel="10:00 PM"
          selected={timeFormat === '12h'}
          onClick={() => update({ timeFormat: '12h' })}
        />
        <RadioRow
          label="24-hour"
          sublabel="22:00"
          selected={timeFormat === '24h'}
          onClick={() => update({ timeFormat: '24h' })}
        />
      </Section>

      <AnimatePresence>
        {dedicated === 'wallpaper' && <ChatWallpaper onBack={() => setDedicated(null)} />}
        {dedicated === 'power' && <PowerSaving onBack={() => setDedicated(null)} />}
      </AnimatePresence>
    </SettingsScreen>
  )
}
