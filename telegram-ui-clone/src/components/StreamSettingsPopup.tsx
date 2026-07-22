// Попап настроек RTMP-трансляции — порт tweb RtmpStartStreamPopup (adminPopup.tsx
// + rtmpData.tsx). Показывает креды для OBS: Server URL и Stream Key (ключ
// маскируется точками, кнопка-глаз показать/скрыть, клик по строке — копирование),
// строку «Сбросить ключ» и кнопку «Начать»/«Закончить трансляцию». Два режима:
// active=false → «Транслировать через…» + START STREAMING; active=true →
// «Настройки трансляции» + END LIVE STREAM.
import { useEffect, useState, type ReactNode } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import TgIcon, { type IconName } from './TgIcon'
import { useManagers } from '../core/hooks/useManagers'
import { uiEvents } from '../core/hooks/uiEvents'
import { watchLivestream, leaveLivestream } from '../core/calls/livestreamEngine'
import { useT } from '../i18n'
import s from './StreamSettingsPopup.module.scss'

interface Props {
  chatId: number
  /** трансляция уже идёт (режим «Настройки/Закончить») */
  active: boolean
  onClose: () => void
}

// Строка данных (URL/Key): клик копирует значение и показывает тост.
function DataRow({ icon, label, value, masked, onCopy, right }: {
  icon: IconName
  label: string
  value: string
  masked?: boolean
  onCopy: () => void
  right?: ReactNode
}) {
  return (
    <div className={s.row} onClick={onCopy}>
      <TgIcon name={icon} size={22} color="var(--tg-textSecondary)" />
      <div className={s.rowBody}>
        <Text size={12} color="var(--tg-textSecondary)">{label}</Text>
        <Text size={15} color="var(--tg-textPrimary)" noWrap className={masked ? s.masked : undefined}>{value}</Text>
      </div>
      {right}
      <TgIcon name="copy" size={20} color="var(--tg-textSecondary)" />
    </div>
  )
}

export default function StreamSettingsPopup({ chatId, active, onClose }: Props) {
  const t = useT()
  const managers = useManagers()
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  // Забираем креды при открытии (бэк генерирует ключ при первом обращении админа).
  useEffect(() => {
    let alive = true
    void managers.livestream.status(chatId).then((st) => {
      if (!alive) return
      setUrl(st.rtmpUrl ?? '')
      setKey(st.streamKey ?? '')
    }).catch(() => {})
    return () => { alive = false }
  }, [managers, chatId])

  const copy = (value: string, toast: string) => {
    if (!value) return
    void navigator.clipboard?.writeText(value).then(() => uiEvents.emit('ui:toast', t(toast))).catch(() => {})
  }

  const revoke = () => {
    if (busy) return
    setBusy(true)
    void managers.livestream.revokeKey(chatId)
      .then((st) => { setUrl(st.rtmpUrl ?? ''); setKey(st.streamKey ?? '') })
      .finally(() => setBusy(false))
  }

  const onAction = () => {
    if (busy) return
    setBusy(true)
    if (active) {
      void managers.livestream.stop(chatId).then(() => {
        leaveLivestream()
        onClose()
      }).finally(() => setBusy(false))
    } else {
      void managers.livestream.start(chatId).then(() => {
        watchLivestream(chatId)
        onClose()
      }).finally(() => setBusy(false))
    }
  }

  // ключ маскируется точками (tweb: первые 20 символов → middot)
  const maskedKey = key ? key.slice(0, 20).replace(/./g, '·') : ''

  return (
    <Popup open title={t(active ? 'Stream Settings' : 'Stream With...')} onClose={onClose} width={420}>
      <div className={s.body}>
        <Text size={14} color="var(--tg-textSecondary)" className={s.desc}>
          {t('To stream video with another app, enter this Server URL and Stream Key in your streaming app. Software encoding recommended (x264 in OBS).')}
        </Text>

        <div className={s.data}>
          <DataRow
            icon="link"
            label={t('Server URL')}
            value={url}
            onCopy={() => copy(url, 'URL copied to clipboard')}
          />
          <DataRow
            icon="lock"
            label={t('Stream Key')}
            value={keyVisible ? key : maskedKey}
            masked={!keyVisible}
            onCopy={() => copy(key, 'Key copied to clipboard')}
            right={
              <button
                className={s.eye}
                onClick={(e) => { e.stopPropagation(); setKeyVisible((v) => !v) }}
                type="button"
              >
                <TgIcon name={keyVisible ? 'eye2' : 'eye1'} size={20} color="var(--tg-textSecondary)" />
              </button>
            }
          />
          <div className={s.revoke} onClick={revoke}>
            <TgIcon name="rotate_left" size={22} color="#e5484d" />
            <Text size={15} color="#e5484d">{t('Revoke Stream Key')}</Text>
          </div>
        </div>

        {!active && (
          <Text size={13} color="var(--tg-textSecondary)" className={s.hint}>
            {t('Once you start broadcasting in your streaming app, click Start Streaming below.')}
          </Text>
        )}

        <button
          className={active ? s.btnDanger : s.btnPrimary}
          disabled={busy}
          onClick={onAction}
          type="button"
        >
          {t(active ? 'END LIVE STREAM' : 'START STREAMING')}
        </button>
      </div>
    </Popup>
  )
}
