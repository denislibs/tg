import { useState } from 'react'
import Popup from '../shared/ui/Popup/Popup'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import { useManagers } from '../core/hooks/useManagers'
import { useStealthState } from '../core/hooks/useStealthState'
import rootScope from '@lib/rootScope'
import { HttpError } from '../core/net/restClient'

// tweb appConfig stories_stealth_past/future_period.
const PAST_LABEL = '5 min'
const FUTURE_LABEL = '25 min'

// Округлённый остаток кулдауна в минутах для строки «Available in %s».
// Граница кулдауна — секунды эпохи (`storiesStealthMode`), те же единицы, что у
// сообщения и черновика.
function cooldownLabel(until: number): string {
  const ms = until * 1000 - Date.now()
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
  const { unavailable, cooldownUntil, setUnavailable } = useStealthState()
  const [busy, setBusy] = useState(false)

  const onCooldown = cooldownUntil != null && cooldownUntil * 1000 > Date.now()

  const activate = async () => {
    if (busy) return
    setBusy(true)
    try {
      await managers.stories.activateStealth()
      rootScope.dispatchEvent('ui:toast', t('Stories.StealthMode.Activated.Title'))
      onClose()
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        rootScope.dispatchEvent('ui:toast', t('Stories.StealthMode.Cooldown.Title'))
      } else if (e instanceof HttpError && e.status === 503) {
        setUnavailable(true)
      } else {
        rootScope.dispatchEvent('ui:toast', t('Error.SomethingWentWrong'))
      }
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || unavailable || onCooldown
  const buttonLabel = unavailable
    ? t('Stories.StealthMode.Unavailable')
    : onCooldown
      ? t('Stories.StealthMode.Cooldown').replace('%s', cooldownLabel(cooldownUntil!))
      : t('Stories.StealthMode.Button')

  const row = (icon: 'backward_5' | 'forward_25', title: string, subtitle: string) => (
    <div style={{ display: 'flex', gap: 16, padding: '10px 20px', alignItems: 'flex-start' }}>
      <div style={{ color: 'var(--primary-color)', flexShrink: 0, marginTop: 2 }}>
        <TgIcon name={icon} size={26} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Text size={15} weight={600} color="var(--primary-text-color)">{title}</Text>
        <Text size={14} color="var(--secondary-text-color)">{subtitle}</Text>
      </div>
    </div>
  )

  return (
    <Popup open title={t('Stories.StealthMode.Title')} onClose={onClose} width={360}>
      <div style={{ padding: '0 20px 4px' }}>
        <Text size={14} color="var(--secondary-text-color)">
          {t('Stories.StealthMode.Subtitle')}
        </Text>
      </div>
      {row('backward_5', t('Stories.StealthMode.Row1.Title'), t('Stories.StealthMode.Row1.Subtitle').replace('%s', PAST_LABEL))}
      {row('forward_25', t('Stories.StealthMode.Row2.Title'), t('Stories.StealthMode.Row2.Subtitle').replace('%s', FUTURE_LABEL))}
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
            background: disabled ? 'var(--secondary-text-color)' : 'var(--tg-accentGradient)',
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
