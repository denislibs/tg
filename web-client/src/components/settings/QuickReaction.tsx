import { useState } from 'react'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import { SettingsScreen, Section } from './kit'
import s from './QuickReaction.module.scss'

const EMOJIS = ['👍', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🎉', '😱', '👎', '💯', '🙏']

export default function QuickReaction({ onBack }: { onBack: () => void }) {
  const t = useT()
  const [picked, setPicked] = useState('👍')

  return (
    <SettingsScreen title="Quick Reaction" onBack={onBack}>
      <div className={s.hero}>
        <div className={s.heroEmoji}>{picked}</div>
        <Text size={14} color="var(--tg-textSecondary)" style={{ marginTop: '8px', paddingLeft: '40px', paddingRight: '40px' }}>
          {t('Double-tap a message to send this reaction quickly.')}
        </Text>
      </div>
      <Section>
        <div className={s.grid}>
          {EMOJIS.map((e) => (
            <div key={e} className={s.cell} data-picked={e === picked || undefined} onClick={() => setPicked(e)}>
              {e}
            </div>
          ))}
        </div>
      </Section>
    </SettingsScreen>
  )
}
