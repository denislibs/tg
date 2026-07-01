import { useState } from 'react'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import { SettingsScreen, Section, Row } from './kit'
import s from './ActiveSessions.module.scss'

interface Sess {
  id: string
  icon: ReactNode
  app: string
  device: string
  loc: string
  last: string
}

const OTHERS: Sess[] = [
  { id: 's1', icon: <TgIcon name="devices" size={26} />, app: 'Telegram iOS 10.2', device: 'iPhone 15 Pro', loc: 'Almaty, Kazakhstan', last: '2 hours ago' },
  { id: 's2', icon: <TgIcon name="devices" size={26} />, app: 'Telegram Desktop', device: 'Windows 11', loc: 'Astana, Kazakhstan', last: 'Jun 18' },
  { id: 's3', icon: <TgIcon name="devices" size={26} />, app: 'Telegram Android', device: 'Pixel 8', loc: 'Almaty, Kazakhstan', last: 'Jun 12' },
]

export default function ActiveSessions({ onBack }: { onBack: () => void }) {
  const t = useT()
  const [others, setOthers] = useState(OTHERS)

  const sessionRow = (sess: Sess, current?: boolean) => (
    <div key={sess.id} className={s.session}>
      <div className={s.icon}>{sess.icon}</div>
      <div className={s.body}>
        <div className={s.top}>
          <Text size={16} color="var(--tg-textPrimary)" className={s.app}>{sess.app}</Text>
          {current ? (
            <Text size={13.5} color="#4dcd5e">{t('online')}</Text>
          ) : (
            <TgIcon
              name="close"
              size={20}
              color="var(--tg-textFaint)"
              onClick={() => setOthers((o) => o.filter((x) => x.id !== sess.id))}
              style={{ cursor: 'pointer' }}
            />
          )}
        </div>
        <Text size={14} color="var(--tg-textSecondary)">{sess.device}</Text>
        <Text size={13.5} color="var(--tg-textFaint)">
          {sess.loc} · {current ? t('online') : sess.last}
        </Text>
      </div>
    </div>
  )

  return (
    <SettingsScreen title="Active Sessions" onBack={onBack}>
      <Section caption="This device">
        {sessionRow(
          { id: 'cur', icon: <TgIcon name="devices" size={26} />, app: 'Telegram Web', device: 'Chrome · macOS', loc: 'Almaty, Kazakhstan', last: '' },
          true,
        )}
      </Section>

      {others.length > 0 && (
        <Section>
          <Row label="Terminate All Other Sessions" danger onClick={() => setOthers([])} />
        </Section>
      )}

      {others.length > 0 ? (
        <Section caption="Active sessions">{others.map((sess) => sessionRow(sess))}</Section>
      ) : (
        <Text size={14} color="var(--tg-textSecondary)" style={{ paddingLeft: '24px', paddingRight: '24px' }}>
          {t('No other active sessions.')}
        </Text>
      )}
    </SettingsScreen>
  )
}
