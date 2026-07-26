import { useState } from 'react'
import { SettingsScreen, Section, Row } from './kit'

const ITEMS = [
  'Autoplay GIFs',
  'Autoplay videos',
  'Loop animated stickers',
  'Animated emoji',
  'Interface animations',
  'Reaction effects',
  'Spoiler effects',
  'Chat background animation',
]

export default function PowerSaving({ onBack }: { onBack: () => void }) {
  // master off => all disabled; we keep per-item state and a master switch
  const [master, setMaster] = useState(true)
  const [items, setItems] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ITEMS.map((i) => [i, true])),
  )

  return (
    <SettingsScreen title="Power Saving" onBack={onBack}>
      <Section footer="Disable animations and effects to reduce power usage.">
        <Row
          label="Enable Animations"
          toggle
          checked={master}
          onClick={() => setMaster((m) => !m)}
        />
      </Section>

      <Section caption="Animations">
        {ITEMS.map((label) => (
          <Row
            key={label}
            label={label}
            toggle
            checked={master && items[label]}
            onClick={() => master && setItems((o) => ({ ...o, [label]: !o[label] }))}
          />
        ))}
      </Section>
    </SettingsScreen>
  )
}
