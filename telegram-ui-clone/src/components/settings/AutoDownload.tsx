import { useState } from 'react'
import { SettingsScreen, Section, Row } from './kit'

const NETS = [
  { key: 'mobile', caption: 'When using mobile data' },
  { key: 'wifi', caption: 'When connected to Wi-Fi' },
  { key: 'roaming', caption: 'When roaming' },
]
const TYPES = ['Photos', 'Videos', 'Files']

const DEFAULTS: Record<string, boolean> = {
  'mobile:Photos': true, 'mobile:Videos': false, 'mobile:Files': false,
  'wifi:Photos': true, 'wifi:Videos': true, 'wifi:Files': true,
  'roaming:Photos': false, 'roaming:Videos': false, 'roaming:Files': false,
}

export default function AutoDownload({ onBack }: { onBack: () => void }) {
  const [on, setOn] = useState<Record<string, boolean>>(DEFAULTS)
  const toggle = (k: string) => setOn((o) => ({ ...o, [k]: !o[k] }))

  return (
    <SettingsScreen title="Auto-Download Media" onBack={onBack}>
      {NETS.map((net) => (
        <Section key={net.key} caption={net.caption}>
          {TYPES.map((type) => {
            const k = `${net.key}:${type}`
            return <Row key={k} label={type} toggle checked={on[k]} onClick={() => toggle(k)} />
          })}
        </Section>
      ))}
      <Section caption="Limits" footer="Larger files are never downloaded automatically.">
        <Row label="Max video size" value="10 MB" onClick={() => {}} />
      </Section>
    </SettingsScreen>
  )
}
