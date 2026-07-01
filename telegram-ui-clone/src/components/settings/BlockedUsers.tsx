import { useState } from 'react'
import TgIcon from '../TgIcon'
import Avatar from '../../shared/ui/Avatar'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import { SettingsScreen, Section, Row, EntryRow } from './kit'

interface Blocked {
  id: string
  name: string
  hint: string
  bg: string
  letter: string
}

const INITIAL: Blocked[] = [
  { id: 'b1', name: 'Spam Bot', hint: '@spam_bot', bg: 'linear-gradient(135deg,#9aa0a6,#5f6368)', letter: 'S' },
  { id: 'b2', name: 'Unknown', hint: '+7 700 000 11 22', bg: 'linear-gradient(135deg,#ff8a5b,#ff6a3d)', letter: 'U' },
  { id: 'b3', name: 'Crypto Promo', hint: '@get_rich_now', bg: 'linear-gradient(135deg,#43cea2,#185a9d)', letter: 'C' },
]

export default function BlockedUsers({ onBack }: { onBack: () => void }) {
  const t = useT()
  const [list, setList] = useState(INITIAL)

  return (
    <SettingsScreen title="Blocked Users" onBack={onBack}>
      <Section footer="Blocked users can't send you messages or see your profile.">
        <Row icon={<TgIcon name="restrict" size={24} />} label="Block User" accent onClick={() => {}} />
      </Section>

      {list.length > 0 ? (
        <Section>
          {list.map((b) => (
            <EntryRow
              key={b.id}
              left={<Avatar background={b.bg} text={b.letter} size={46} />}
              title={b.name}
              sub={b.hint}
              onRemove={() => setList((l) => l.filter((x) => x.id !== b.id))}
            />
          ))}
        </Section>
      ) : (
        <Text size={14} color="var(--tg-textSecondary)" style={{ paddingLeft: '24px', paddingRight: '24px' }}>
          {t("You haven't blocked anyone.")}
        </Text>
      )}
    </SettingsScreen>
  )
}
