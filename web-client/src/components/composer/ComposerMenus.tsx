// composer/ComposerMenus.tsx
// Три всплывающих меню композера, каждое со своим якорем: опции плашки форварда
// (tweb reply-line-menu), таймер самоуничтожения секретного чата и выбор типа
// записи «голос / кружок» (tweb recording mode menu, chatRecording.ts:855-896).
//
// отступление от tweb: все три — наш shared/ui/Menu в портале с готовыми
// координатами точки клика; tweb держит `.btn-menu` внутри хоста-кнопки и
// выбирает угол классом. Порт positionMenu() — отдельная задача программы.
import Menu, { MenuItem } from '../../shared/ui/Menu'
import TgIcon from '../TgIcon'
import { useT } from '../../i18n'
import { TTL_OPTIONS } from './helpers'
import type { ForwardBar } from '../Composer'

export interface Anchor { left?: number; right?: number; bottom: number }

interface Props {
  forward: ForwardBar | null
  forwardMenuOpen: boolean
  forwardMenuAnchor: Anchor | null
  onCloseForwardMenu: () => void
  onForwardOption: (opt: { dropAuthor?: boolean; dropCaption?: boolean }) => void
  onForwardAnother: () => void
  onCancelForward: () => void

  ttlAnchor: Anchor | null
  ttlSeconds: number | null
  onPickTtl: (secs: number | null) => void
  onCloseTtl: () => void

  recordAnchor: Anchor | null
  onPickRecordingMode: (mode: 'voice' | 'round') => void
  onCloseRecord: () => void
}

export default function ComposerMenus({
  forward, forwardMenuOpen, forwardMenuAnchor, onCloseForwardMenu, onForwardOption, onForwardAnother, onCancelForward,
  ttlAnchor, ttlSeconds, onPickTtl, onCloseTtl,
  recordAnchor, onPickRecordingMode, onCloseRecord,
}: Props) {
  const t = useT()
  const check = (on: boolean) => <TgIcon name="check" size={20} color={on ? 'var(--primary-color)' : 'transparent'} />
  return (
    <>
      <Menu
        open={forwardMenuOpen}
        onClose={onCloseForwardMenu}
        corner="top-right"
        style={forwardMenuAnchor ?? undefined}
      >
        <MenuItem
          icon={check(!!forward && !forward.dropAuthor)}
          label={t('Chat.Alert.Forward.ShowSenderName')}
          onClick={() => { onForwardOption({ dropAuthor: false }); onCloseForwardMenu() }}
        />
        <MenuItem
          icon={check(!!forward && forward.dropAuthor)}
          label={t('Chat.Alert.Forward.HideSenderName')}
          onClick={() => { onForwardOption({ dropAuthor: true }); onCloseForwardMenu() }}
        />
        {forward?.hasCaption && (
          <>
            <MenuItem
              icon={check(!forward.dropCaption)}
              label={t('Chat.Alert.Forward.ShowCaption')}
              onClick={() => { onForwardOption({ dropCaption: false }); onCloseForwardMenu() }}
            />
            <MenuItem
              icon={check(forward.dropCaption)}
              label={t('Chat.Alert.Forward.HideCaption')}
              onClick={() => { onForwardOption({ dropCaption: true }); onCloseForwardMenu() }}
            />
          </>
        )}
        <MenuItem
          icon={<TgIcon name="replace" size={20} />}
          label={t('Chat.Alert.Forward.Action.Another')}
          onClick={() => { onCloseForwardMenu(); onForwardAnother() }}
        />
        <MenuItem
          icon={<TgIcon name="delete" size={20} />}
          label={t('DoNotForward')}
          danger
          onClick={() => { onCloseForwardMenu(); onCancelForward() }}
        />
      </Menu>

      {ttlAnchor && (
        <Menu open onClose={onCloseTtl} corner="top-right" style={ttlAnchor}>
          {TTL_OPTIONS.map((o) => (
            <MenuItem
              key={o.label}
              icon={<TgIcon name="timer" size={20} />}
              label={o.secs == null ? t('AutoDeleteMessages.Disable') : o.label}
              right={ttlSeconds === o.secs ? <TgIcon name="check" size={18} color="var(--primary-color)" /> : undefined}
              onClick={() => onPickTtl(o.secs)}
            />
          ))}
        </Menu>
      )}

      {recordAnchor && (
        <Menu open onClose={onCloseRecord} corner="top-left" style={recordAnchor}>
          <MenuItem
            icon={<TgIcon name="microphone" size={20} />}
            label={t('Composer.RecordVoice')}
            onClick={() => onPickRecordingMode('voice')}
          />
          <MenuItem
            icon={<TgIcon name="recordround" size={20} />}
            label={t('Composer.RecordRound')}
            onClick={() => onPickRecordingMode('round')}
          />
        </Menu>
      )}
    </>
  )
}
