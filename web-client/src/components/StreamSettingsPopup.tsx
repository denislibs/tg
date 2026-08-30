// Попап настроек RTMP-трансляции — порт tweb RtmpStartStreamPopup (adminPopup.tsx
// + rtmpData.tsx). Показывает креды для OBS: Server URL и Stream Key (ключ
// маскируется точками, кнопка-глаз показать/скрыть, клик по строке — копирование),
// строку «Сбросить ключ» и кнопку «Начать»/«Закончить трансляцию». Два режима:
// active=false → «Транслировать через…» + START STREAMING; active=true →
// «Настройки трансляции» + END LIVE STREAM.
import type { LangPackKey } from '@/lang'
import { useState, type ReactNode } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import TgIcon, { type IconName } from './TgIcon'
import { useLivestreamSettings } from '../core/hooks/useLivestreamSettings'
import rootScope from '@lib/rootScope'
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
  label: LangPackKey
  value: string
  masked?: boolean
  onCopy: () => void
  right?: ReactNode
}) {
  return (
    <div className={s.row} onClick={onCopy}>
      <TgIcon name={icon} size={22} color="var(--secondary-text-color)" />
      <div className={s.rowBody}>
        <Text size={12} color="var(--secondary-text-color)">{label}</Text>
        <Text size={15} color="var(--primary-text-color)" noWrap className={masked ? s.masked : undefined}>{value}</Text>
      </div>
      {right}
      <TgIcon name="copy" size={20} color="var(--secondary-text-color)" />
    </div>
  )
}

export default function StreamSettingsPopup({ chatId, active, onClose }: Props) {
  const t = useT()
  const { url, key, busy, revoke, onAction } = useLivestreamSettings(chatId, active, onClose)
  const [keyVisible, setKeyVisible] = useState(false)

  const copy = (value: string, toast: LangPackKey) => {
    if (!value) return
    void navigator.clipboard?.writeText(value).then(() => rootScope.dispatchEvent('ui:toast', t(toast))).catch(() => {})
  }

  // ключ маскируется точками (tweb: первые 20 символов → middot)
  const maskedKey = key ? key.slice(0, 20).replace(/./g, '·') : ''

  return (
    <Popup open title={t(active ? 'Rtmp.StreamPopup.TitleSettings' : 'Rtmp.StreamPopup.Title')} onClose={onClose} width={420}>
      <div className={s.body}>
        <Text size={14} color="var(--secondary-text-color)" className={s.desc}>
          {t('Rtmp.StreamPopup.Description')}
        </Text>

        <div className={s.data}>
          <DataRow
            icon="link"
            label="Rtmp.StreamPopup.ServerURL"
            value={url}
            onCopy={() => copy(url, 'Rtmp.StreamPopup.URLCopied')}
          />
          <DataRow
            icon="lock"
            label="Rtmp.StreamPopup.StreamKey"
            value={keyVisible ? key : maskedKey}
            masked={!keyVisible}
            onCopy={() => copy(key, 'Rtmp.StreamPopup.KeyCopied')}
            right={
              <button
                className={s.eye}
                onClick={(e) => { e.stopPropagation(); setKeyVisible((v) => !v) }}
                type="button"
              >
                <TgIcon name={keyVisible ? 'eye2' : 'eye1'} size={20} color="var(--secondary-text-color)" />
              </button>
            }
          />
          <div className={s.revoke} onClick={revoke}>
            <TgIcon name="rotate_left" size={22} color="#e5484d" />
            <Text size={15} color="#e5484d">{t('Rtmp.StreamPopup.RevokeStreamKey')}</Text>
          </div>
        </div>

        {!active && (
          <Text size={13} color="var(--secondary-text-color)" className={s.hint}>
            {t('Rtmp.StreamPopup.Hint')}
          </Text>
        )}

        <button
          className={active ? s.btnDanger : s.btnPrimary}
          disabled={busy}
          onClick={onAction}
          type="button"
        >
          {t(active ? 'Rtmp.StreamPopup.EndLiveStream' : 'Rtmp.StreamPopup.StartStreaming')}
        </button>
      </div>
    </Popup>
  )
}
