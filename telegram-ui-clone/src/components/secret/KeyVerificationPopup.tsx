// Экран «Ключ шифрования» секретного чата (tweb chatEncryptionKey): сетка из 12
// emoji-fingerprint'ов handshake'а. Пользователи сверяют картинку вживую, чтобы
// исключить MITM. Emoji рендерятся как текстовые ноды (строки), не как HTML.
import Popup from '../../shared/ui/Popup'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import { useSecretChatStore } from '../../stores/secretChatStore'

export default function KeyVerificationPopup({
  open, onClose, onExitComplete, chatId,
}: {
  open: boolean
  onClose: () => void
  onExitComplete?: () => void
  chatId: number
}) {
  const t = useT()
  const fp = useSecretChatStore((s) => s.byChat[chatId]?.fingerprint)

  return (
    <Popup
      open={open}
      title={t('Encryption Key')}
      onClose={onClose}
      onExitComplete={onExitComplete}
      width={420}
      action={{ label: t('OK'), onClick: onClose }}
    >
      {fp && fp.length > 0 ? (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '8px 12px',
              maxWidth: 260,
              margin: '8px auto 20px',
            }}
          >
            {fp.map((emoji, i) => (
              <span key={i} style={{ fontSize: 34, lineHeight: 1.15, width: 44, textAlign: 'center' }}>
                {emoji}
              </span>
            ))}
          </div>
          <Text
            size={14}
            color="var(--tg-textSecondary)"
            style={{ display: 'block', textAlign: 'center', padding: '0 8px' }}
          >
            {t("Compare these emoji with the ones your contact sees on their device. If they match, the chat is end-to-end encrypted.")}
          </Text>
        </>
      ) : (
        <Text
          size={15}
          color="var(--tg-textSecondary)"
          style={{ display: 'block', textAlign: 'center', padding: '24px 8px' }}
        >
          {t('The encryption key has not been agreed yet.')}
        </Text>
      )}
    </Popup>
  )
}
