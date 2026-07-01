import { useState } from 'react'
import TgIcon from '../TgIcon'
import { SettingsScreen, Section, Row, EntryRow } from './kit'

interface Key {
  id: string
  name: string
  added: string
}

const INITIAL: Key[] = [
  { id: 'k1', name: 'iCloud Keychain', added: 'Added Jun 10' },
  { id: 'k2', name: 'YubiKey 5C', added: 'Added May 2' },
]

export default function Passkeys({ onBack }: { onBack: () => void }) {
  const [keys, setKeys] = useState(INITIAL)

  return (
    <SettingsScreen title="Passkeys & Login Email" onBack={onBack}>
      <Section caption="Passkeys" footer="Passkeys let you sign in without a password using your device.">
        <Row icon={<TgIcon name="add" size={24} />} label="Add a Passkey" accent onClick={() => {}} />
      </Section>

      {keys.length > 0 && (
        <Section>
          {keys.map((k) => (
            <EntryRow
              key={k.id}
              left={<TgIcon name="key" size={24} color="var(--tg-accent)" />}
              title={k.name}
              sub={k.added}
              onRemove={() => setKeys((l) => l.filter((x) => x.id !== k.id))}
            />
          ))}
        </Section>
      )}

      <Section caption="Login Email" footer="This email is used to log in if you lose access to your number.">
        <Row label="Email" value="d•••@documentolog.com" onClick={() => {}} />
        <Row label="Change Login Email" accent onClick={() => {}} />
      </Section>
    </SettingsScreen>
  )
}
