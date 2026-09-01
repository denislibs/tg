// Passkeys — ключи доступа (tweb AppPasskeysTab): реальный список с бэка,
// создание через WebAuthn (navigator.credentials.create), удаление крестиком.
import { useCallback, useEffect, useState } from 'react'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import { DayDate } from '../../shared/ui/dateNodes'
import { useT } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { isWebAuthnSupported, createPasskey } from '../../core/webauthnBrowser'
import type { PasskeyInfo } from '../../core/managers/authManager'
import { SettingsScreen, Section, Row, EntryRow } from './kit'

export default function Passkeys({ onBack }: { onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const [keys, setKeys] = useState<PasskeyInfo[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    managers.auth.passkeysList().then(setKeys).catch(() => {})
  }, [managers])

  useEffect(() => reload(), [reload])

  const add = async () => {
    if (busy) return
    setError('')
    if (!isWebAuthnSupported()) {
      setError(t('Passkeys.Unsupported'))
      return
    }
    setBusy(true)
    try {
      const { session, options } = await managers.auth.passkeyRegisterBegin()
      const attestation = await createPasskey(options)
      await managers.auth.passkeyRegisterFinish(session, attestation)
      reload()
    } catch {
      setError(t('Passkey.CreateError'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    setKeys((l) => l.filter((k) => k.id !== id)) // оптимистично
    await managers.auth.passkeyDelete(id).catch(() => {})
    reload()
  }

  return (
    <SettingsScreen title="Privacy.Passkeys" onBack={onBack}>
      <Section
        caption="Privacy.Passkeys"
        footer="Passkeys.Caption"
      >
        <Row icon={<TgIcon name="add" size={24} />} label="Passkeys.Add" accent onClick={() => void add()} />
      </Section>
      {error && (
        <Text size={13.5} color="#ff595a" style={{ padding: '0 24px' }}>{error}</Text>
      )}

      {keys.length > 0 && (
        <Section>
          {/* Дата — живой узел `formatDate` ядра. Прежде здесь язык УГАДЫВАЛСЯ
              (`lang === 'ru' ? 'ru-RU' : undefined`): под `undefined` пряталась
              локаль БРАУЗЕРА, а четыре остальных языка приложения не
              учитывались вовсе. */}
          {keys.map((k) => (
            <EntryRow
              key={k.id}
              left={<TgIcon name="key" size={24} color="var(--primary-color)" />}
              title={k.name || t('Passkeys.Item')}
              sub={
                <>
                  {k.lastUsedAt ? t('Passkeys.LastUsed') : t('Passkeys.Created')}
                  {': '}
                  <DayDate date={Math.floor(Date.parse(k.lastUsedAt || k.createdAt) / 1000)} shortMonth />
                </>
              }
              onRemove={() => void remove(k.id)}
            />
          ))}
        </Section>
      )}
    </SettingsScreen>
  )
}
