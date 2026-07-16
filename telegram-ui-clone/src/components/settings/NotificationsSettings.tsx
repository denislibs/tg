// Настройки → «Notifications and Sounds» — порт tweb
// (src/components/sidebarLeft/tabs/notifications.tsx): Web Notifications
// (гейт по разрешению браузера + кнопка Enable) → Sound (звук + громкость
// с тестом на отпускание) → Sound Effects → Private Chats/Groups/Channels
// (Notifications for… + Message Preview, хранятся на бэке).
import { useState } from 'react'
import Text from '../../shared/ui/Text'
import Slider from '../../shared/ui/Slider'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { useSettings } from '../../settings'
import { useManagers } from '../../core/hooks/useManagers'
import { useNotifyStore } from '../../stores/notifyStore'
import type { NotifyChatType } from '../../core/managers/notifyManager'
import { playSound } from '../../core/audio/sounds'
import { setupPush, setPushEnabled } from '../../client/pushSetup'
import { SettingsScreen, Section, Row } from './kit'
import s from './NotificationsSettings.module.scss'

const PERMISSION_FOOTER =
  'Give Telegram permission to send notifications. You may need to refresh the page to see the changes.'

const TYPE_SECTIONS: { name: string; typeText: string; key: NotifyChatType }[] = [
  { name: 'Private Chats', typeText: 'Notifications for private chats', key: 'private' },
  { name: 'Groups', typeText: 'Notifications for groups', key: 'groups' },
  { name: 'Channels', typeText: 'Notifications for channels', key: 'channels' },
]

export default function NotificationsSettings({ onBack }: { onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const { notifyDesktop, notifyPush, notifySound, notifyVolume, sentMessageSound, update } = useSettings()
  const settings = useNotifyStore((st) => st.settings)
  const setType = useNotifyStore((st) => st.setType)
  const [perm, setPerm] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  )
  const granted = perm === 'granted'

  // tweb: пока разрешения нет, тумблеры форсятся в выключенное состояние,
  // а клик по ним (и кнопка Enable) запрашивает разрешение браузера.
  const requestPermission = () => {
    if (typeof Notification === 'undefined') return
    void Notification.requestPermission().then((p) => {
      setPerm(p)
      if (p === 'granted' && notifyPush) void setupPush()
    })
  }

  const updateType = (key: NotifyChatType, patch: { muted?: boolean; preview?: boolean }) => {
    setType(key, patch) // оптимистично
    void managers.notify.update({ [key]: patch }).catch(() => {
      // не сохранилось — откатываемся к серверному состоянию
      void managers.notify
        .settings()
        .then((server) => useNotifyStore.getState().set(server))
        .catch(() => undefined)
    })
  }

  return (
    <SettingsScreen title="Notifications and Sounds" onBack={onBack}>
      <Section caption="Web Notifications" footer={granted ? undefined : PERMISSION_FOOTER}>
        <Row
          label="Show notifications"
          toggle
          checked={granted && notifyDesktop}
          onClick={() => (granted ? update({ notifyDesktop: !notifyDesktop }) : requestPermission())}
        />
        <Row
          label="Show offline notifications"
          toggle
          checked={granted && notifyPush}
          onClick={() => {
            if (!granted) return requestPermission()
            const next = !notifyPush
            update({ notifyPush: next })
            void setPushEnabled(next)
          }}
        />
        {!granted && (
          <Row icon={<TgIcon name="unmute" size={24} />} label="Enable Notifications" accent onClick={requestPermission} />
        )}
      </Section>

      <Section caption="Sound" footer="Drag and release or click to test the volume.">
        <Row
          label="Notification Sound"
          toggle
          checked={notifySound}
          onClick={() =>
            // tweb: включение при нулевой громкости возвращает дефолтные 50%
            update({ notifySound: !notifySound, ...(!notifySound && notifyVolume === 0 ? { notifyVolume: 0.5 } : {}) })
          }
        />
        <div className={s.volume}>
          <div className={s.volumeTop}>
            <Text size={16} color="var(--tg-textPrimary)">{t('Sound Volume')}</Text>
            <Text size={16} color="var(--tg-textFaint)">{Math.floor(notifyVolume * 100)}%</Text>
          </div>
          {/* tweb: отпускание ползунка проигрывает тестовый звук */}
          <div onPointerUp={() => notifyVolume > 0 && playSound('notification', { volume: notifyVolume })}>
            <Slider value={notifyVolume} min={0} max={1} step={0.01} onChange={(v) => update({ notifyVolume: v })} className={s.slider} />
          </div>
        </div>
      </Section>

      <Section caption="Sound Effects">
        <Row
          label="Message Sent"
          toggle
          checked={sentMessageSound}
          onClick={() => update({ sentMessageSound: !sentMessageSound })}
        />
      </Section>

      {TYPE_SECTIONS.map((sec) => (
        <Section key={sec.key} caption={sec.name}>
          <Row
            label={sec.typeText}
            toggle
            checked={!settings[sec.key].muted}
            onClick={() => updateType(sec.key, { muted: !settings[sec.key].muted })}
          />
          <Row
            label="Message Preview"
            toggle
            checked={settings[sec.key].preview}
            onClick={() => updateType(sec.key, { preview: !settings[sec.key].preview })}
          />
        </Section>
      ))}
    </SettingsScreen>
  )
}
