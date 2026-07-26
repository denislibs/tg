import { useEffect, useState } from 'react'
import Popup from '../shared/ui/Popup/Popup'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import { useManagers } from '../core/hooks/useManagers'
import { uiEvents } from '../core/hooks/uiEvents'
import { HttpError } from '../core/net/restClient'

// tweb appConfig stories_stealth_past/future_period.
const PAST_LABEL = '5 min'
const FUTURE_LABEL = '25 min'

// Округлённый остаток кулдауна в минутах для строки «Available in %s».
function cooldownLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  const mins = Math.max(1, Math.ceil(ms / 60000))
  return `${mins} min`
}

/**
 * Stealth Mode popup — 1:1 с tweb storiesStealthMode: заголовок/подзаголовок и
 * две строки (Hide Recent Views / Hide Upcoming Views) с длительностями, кнопка
 * активации. Загружает текущее окно: если кулдаун ещё идёт — кнопка
 * задизейблена с таймером; если stealth недоступен (503, нет Redis) — сообщаем
 * об этом. После активации — тост (Stories.StealthMode.Activated.Title).
 */
export default function StealthModePopup({ onClose }: { onClose: () => void }) {
  const t = useT()
  const managers = useManagers()
  const [unavailable, setUnavailable] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    managers.stories
      .stealthState()
      .then((st) => { if (alive) setCooldownUntil(st.cooldownUntil) })
      .catch((e) => { if (alive && e instanceof HttpError && e.status === 503) setUnavailable(true) })
    return () => { alive = false }
  }, [managers])

  const onCooldown = cooldownUntil != null && new Date(cooldownUntil).getTime() > Date.now()

  const activate = async () => {
    if (busy) return
    setBusy(true)
    try {
      await managers.stories.activateStealth()
      uiEvents.emit('ui:toast', t('Stealth Mode On'))
      onClose()
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        uiEvents.emit('ui:toast', t('Stealth Mode is on a cooldown'))
      } else if (e instanceof HttpError && e.status === 503) {
        setUnavailable(true)
      } else {
        uiEvents.emit('ui:toast', t('Something went wrong'))
      }
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || unavailable || onCooldown
  const buttonLabel = unavailable
    ? t('Stealth Mode is unavailable')
    : onCooldown
      ? t('Available in %s').replace('%s', cooldownLabel(cooldownUntil!))
      : t('ENABLE STEALTH MODE')

  const row = (icon: 'backward_5' | 'forward_25', title: string, subtitle: string) => (
    <div style={{ display: 'flex', gap: 16, padding: '10px 20px', alignItems: 'flex-start' }}>
      <div style={{ color: 'var(--tg-accent)', flexShrink: 0, marginTop: 2 }}>
        <TgIcon name={icon} size={26} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Text size={15} weight={600} color="var(--tg-textPrimary)">{title}</Text>
        <Text size={14} color="var(--tg-textSecondary)">{subtitle}</Text>
      </div>
    </div>
  )

  return (
    <Popup open title={t('Stealth Mode')} onClose={onClose} width={360}>
      <div style={{ padding: '0 20px 4px' }}>
        <Text size={14} color="var(--tg-textSecondary)">
          {t('Turn Stealth Mode on to watch without appearing in the list of viewers.')}
        </Text>
      </div>
      {row('backward_5', t('Hide Recent Views'), t('Hide my views from the past %s.').replace('%s', PAST_LABEL))}
      {row('forward_25', t('Hide Upcoming Views'), t('Hide my views for the next %s.').replace('%s', FUTURE_LABEL))}
      <div style={{ padding: '8px 16px 16px' }}>
        <button
          onClick={activate}
          disabled={disabled}
          style={{
            width: '100%',
            padding: '12px 0',
            borderRadius: 12,
            border: 'none',
            cursor: disabled ? 'default' : 'pointer',
            background: disabled ? 'var(--tg-textFaint)' : 'var(--tg-accentGradient)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            fontFamily: 'inherit',
            textTransform: 'uppercase',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </Popup>
  )
}
