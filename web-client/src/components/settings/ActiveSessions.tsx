// Активные сессии — реальные данные с бэка (GET /sessions): текущая сессия,
// завершение одной (DELETE /sessions/{id}) и всех остальных (DELETE /sessions/others).
// Отозванная сессия теряет токен сразу, её сокеты закрываются сервером.
import { useEffect, useState } from 'react'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import { useT, useLang } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { friendlyMsgTime } from '../../core/friendlyTime'
import type { Session } from '../../core/managers/sessionsManager'
import { SettingsScreen, Section, Row } from './kit'
import s from './ActiveSessions.module.scss'

// «Telegram Web» для браузерных сессий, иначе платформа как есть.
function appLabel(sess: Session): string {
  const p = sess.platform.toLowerCase()
  if (p === 'browser' || p === 'web') return 'Telegram Web'
  return `Telegram ${sess.platform}`
}

export default function ActiveSessions({ onBack }: { onBack: () => void }) {
  const t = useT()
  const [lang] = useLang()
  const managers = useManagers()
  const [sessions, setSessions] = useState<Session[] | null>(null)

  useEffect(() => {
    void managers.sessions.list().then(setSessions).catch(() => setSessions([]))
  }, [managers])

  const current = sessions?.find((x) => x.current)
  const others = sessions?.filter((x) => !x.current) ?? []

  const terminate = async (id: number) => {
    setSessions((list) => list?.filter((x) => x.id !== id) ?? null)
    try {
      await managers.sessions.terminate(id)
    } catch {
      void managers.sessions.list().then(setSessions) // откат к серверному состоянию
    }
  }

  const terminateOthers = async () => {
    setSessions((list) => list?.filter((x) => x.current) ?? null)
    try {
      await managers.sessions.terminateOthers()
    } catch {
      void managers.sessions.list().then(setSessions)
    }
  }

  const sessionRow = (sess: Session) => {
    const place = sess.location || sess.ip
    const when = sess.current ? t('online') : friendlyMsgTime(sess.lastActive, lang)
    return (
      <div key={sess.id} className={s.session}>
        <div className={s.icon}><TgIcon name="devices" size={26} /></div>
        <div className={s.body}>
          <div className={s.top}>
            <Text size={16} color="var(--tg-textPrimary)" className={s.app}>{appLabel(sess)}</Text>
            {sess.current ? (
              <Text size={13.5} color="#4dcd5e">{t('online')}</Text>
            ) : (
              <TgIcon
                name="close"
                size={20}
                color="var(--tg-textFaint)"
                onClick={() => void terminate(sess.id)}
                style={{ cursor: 'pointer' }}
              />
            )}
          </div>
          <Text size={14} color="var(--tg-textSecondary)">{sess.name}</Text>
          <Text size={13.5} color="var(--tg-textFaint)">
            {place ? `${place} · ${when}` : when}
          </Text>
        </div>
      </div>
    )
  }

  return (
    <SettingsScreen title="Active Sessions" onBack={onBack}>
      {current && <Section caption="This device">{sessionRow(current)}</Section>}

      {others.length > 0 && (
        <Section>
          <Row label="Terminate All Other Sessions" danger onClick={() => void terminateOthers()} />
        </Section>
      )}

      {others.length > 0 ? (
        <Section caption="Active sessions">{others.map(sessionRow)}</Section>
      ) : (
        sessions != null && (
          <Text size={14} color="var(--tg-textSecondary)" style={{ paddingLeft: '24px', paddingRight: '24px' }}>
            {t('No other active sessions.')}
          </Text>
        )
      )}
    </SettingsScreen>
  )
}
