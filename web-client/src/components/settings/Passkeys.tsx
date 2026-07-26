// Passkeys — ключи доступа (tweb AppPasskeysTab): реальный список с бэка,
// создание через WebAuthn (navigator.credentials.create), удаление крестиком.
import { useCallback, useEffect, useState } from 'react'
import TgIcon from '../TgIcon'
import Text from '../../shared/ui/Text'
import { useT, useLang } from '../../i18n'
import { useManagers } from '../../core/hooks/useManagers'
import { isWebAuthnSupported, createPasskey } from '../../core/webauthnBrowser'
import type { PasskeyInfo } from '../../core/managers/authManager'
import { SettingsScreen, Section, Row, EntryRow } from './kit'

function fmtDate(iso: string, lang: string): string {
  try {
    return new Date(iso).toLocaleDateString(lang === 'ru' ? 'ru-RU' : undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch {
    return iso
  }
}

export default function Passkeys({ onBack }: { onBack: () => void }) {
  const t = useT()
  const [lang] = useLang()
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
      setError(t('Passkeys are not supported in this browser.'))
      return
    }
    setBusy(true)
    try {
      const { session, options } = await managers.auth.passkeyRegisterBegin()
      const attestation = await createPasskey(options)
      await managers.auth.passkeyRegisterFinish(session, attestation)
      reload()
    } catch {
      setError(t('Could not create a passkey.'))
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
    <SettingsScreen title="Passkeys" onBack={onBack}>
      <Section
        caption="Passkeys"
        footer="Passkeys let you sign in without a password, using your fingerprint, face or device PIN."
      >
        <Row icon={<TgIcon name="add" size={24} />} label="Add a Passkey" accent onClick={() => void add()} />
      </Section>
      {error && (
        <Text size={13.5} color="#ff595a" style={{ padding: '0 24px' }}>{error}</Text>
      )}

      {keys.length > 0 && (
        <Section>
          {keys.map((k) => (
            <EntryRow
              key={k.id}
              left={<TgIcon name="key" size={24} color="var(--tg-accent)" />}
              title={k.name || t('Passkey')}
              sub={
                k.lastUsedAt
                  ? `${t('Last used')}: ${fmtDate(k.lastUsedAt, lang)}`
                  : `${t('Created')}: ${fmtDate(k.createdAt, lang)}`
              }
              onRemove={() => void remove(k.id)}
            />
          ))}
        </Section>
      )}
    </SettingsScreen>
  )
}
