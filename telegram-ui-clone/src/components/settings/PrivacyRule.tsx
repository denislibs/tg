import { useState } from 'react'
import AddRounded from '@mui/icons-material/AddRounded'
import { SettingsScreen, Section, Row } from './kit'

const OPTIONS = ['Everybody', 'My Contacts', 'Nobody'] as const

// footnote per rule (mirrors tweb privacy descriptions)
const FOOTERS: Record<string, string> = {
  'Phone Number': 'Users who add your number will see it only if it is allowed here.',
  'Last Seen & Online': 'You won’t see Last Seen times for people you don’t share yours with.',
  'Profile Photo': 'Choose who can see your profile photo.',
  Calls: 'Choose who can call you.',
  'Forwarded Messages': 'Choose who can add a link to your account when forwarding your messages.',
  'Groups & Channels': 'Choose who can add you to groups and channels.',
}

export default function PrivacyRule({ title, onBack }: { title: string; onBack: () => void }) {
  const [value, setValue] = useState<(typeof OPTIONS)[number]>('Everybody')

  return (
    <SettingsScreen title={title} onBack={onBack}>
      <Section caption="Who can see this" footer={FOOTERS[title]}>
        {OPTIONS.map((o) => (
          <Row key={o} label={o} selected={value === o} onClick={() => setValue(o)} />
        ))}
      </Section>

      {value !== 'Everybody' && (
        <Section caption="Always allow" footer="These users will always see this, regardless of the setting above.">
          <Row icon={<AddRounded />} label="Add Users" accent onClick={() => {}} />
        </Section>
      )}
      {value !== 'Nobody' && (
        <Section caption="Never allow" footer="These users will never see this, regardless of the setting above.">
          <Row icon={<AddRounded />} label="Add Users" accent onClick={() => {}} />
        </Section>
      )}
    </SettingsScreen>
  )
}
