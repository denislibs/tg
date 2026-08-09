import { useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import TgIcon from './TgIcon'
import { useT } from '../i18n'
import s from './NewChannelFlow.module.scss'

interface Props {
  onClose: () => void
  onCreate: (name: string, description: string) => void
}

export default function NewChannelFlow({ onClose, onCreate }: Props) {
  const t = useT()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const canNext = name.trim().length > 0

  return (
    <div className={s.screen}>
      <div className={s.header}>
        <IconButton onClick={onClose} color="var(--secondary-text-color)">
          <TgIcon name="back" />
        </IconButton>
        <Text size={19} weight={600} color="var(--primary-text-color)">
          {t('New Channel')}
        </Text>
      </div>

      <div className={s.body}>
        <div className={s.card}>
          <div className={s.avatarWrap}>
            {/* tweb не масштабирует ни кнопку аватара, ни угловую кнопку по
                hover/tap — отклик там даёт ripple и смена фона (_button.scss:75-77),
                поэтому прежние whileHover/whileTap убраны, а не переложены на CSS. */}
            <div className={s.avatarBtn}>
              <TgIcon name="cameraadd" size={44} />
            </div>
          </div>
          <Input
            autoFocus
            label={t('Channel name')}
            value={name}
            onChange={setName}
            wrapClassName={`${s.field} ${s.fieldGap}`}
          />
          <Input
            label={t('Description (optional)')}
            value={desc}
            onChange={setDesc}
            wrapClassName={s.field}
          />
        </div>
        <Text size={14.5} color="var(--secondary-text-color)" className={s.hint}>
          {t('You can provide an optional description for your channel.')}
        </Text>
      </div>

      <div
        onClick={() => canNext && onCreate(name.trim(), desc.trim())}
        className={s.fab}
        style={{ cursor: canNext ? 'pointer' : 'default', opacity: canNext ? 1 : 0.45 }}
      >
        <TgIcon name="arrow_next" />
      </div>
    </div>
  )
}
