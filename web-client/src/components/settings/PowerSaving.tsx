import { useState } from 'react'
import { SettingsScreen, Section, Row } from './kit'

const ITEMS = [
  'LiteMode.Key.gif.Title',
  'LiteMode.Key.video.Title',
  'InstalledStickers.LoopAnimated',
  'LiteMode.Key.emoji.Title',
  'LiteMode.Key.animations.Title',
  'LiteMode.Key.effects_reactions.Title',
  'LiteMode.Key.chat_spoilers.Title',
  'LiteMode.Key.background_animation.Title',
]

export default function PowerSaving({ onBack }: { onBack: () => void }) {
  // master off => all disabled; we keep per-item state and a master switch
  const [master, setMaster] = useState(true)
  const [items, setItems] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ITEMS.map((i) => [i, true])),
  )

  return (
    <SettingsScreen title="LiteMode.Title" onBack={onBack}>
      <Section footer="LiteMode.Caption">
        <Row
          label="EnableAnimations"
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
