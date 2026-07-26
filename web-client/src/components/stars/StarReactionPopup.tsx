// Попап платной ⭐-реакции (tweb PopupStarReaction): слайдер количества звёзд,
// баланс, список топ-отправителей, опция анонимности и кнопка «Send N». Списание
// идёт через managers.messages.sendStarReaction; при нехватке звёзд открывается
// попап пополнения (как в SendGiftPopup).
import { useEffect, useState } from 'react'
import Popup from '../../shared/ui/Popup'
import Slider from '../../shared/ui/Slider'
import Button from '../../shared/ui/Button'
import Checkbox from '../../shared/ui/Checkbox'
import Text from '../../shared/ui/Text'
import Avatar from '../../shared/ui/Avatar'
import StarIcon from './StarIcon'
import StarsPopup from './StarsPopup'
import { peerColor } from '../peerColor'
import { useManagers } from '../../core/hooks/useManagers'
import { useStarsStore } from '../../stores/starsStore'
import { useMessagesStore } from '../../stores/messagesStore'
import { useT } from '../../i18n'
import type { StarSender } from '../../core/managers/messagesManager'
import s from './starReaction.module.scss'

// Верхняя граница одной порции звёзд (backend maxStarReaction). Слайдер 1..MAX.
const MAX_STARS = 2500
const DEFAULT_STARS = 50

export default function StarReactionPopup({
  open, chatId, msgId, onClose,
}: {
  open: boolean
  chatId: number
  msgId: number
  onClose: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const balance = useStarsStore((st) => st.balance)
  const [count, setCount] = useState(DEFAULT_STARS)
  // «Показывать моё имя» — инверсия анонимности (по умолчанию показываем).
  const [showName, setShowName] = useState(true)
  const [top, setTop] = useState<StarSender[]>([])
  const [busy, setBusy] = useState(false)
  const [topupOpen, setTopupOpen] = useState(false)

  // Текущий агрегат + топ-отправители сообщения при открытии.
  useEffect(() => {
    if (!open) return
    let alive = true
    void managers.messages.getStarReaction(chatId, msgId)
      .then((info) => { if (alive) setTop(info.top) })
      .catch(() => {})
    return () => { alive = false }
  }, [open, chatId, msgId, managers])

  const send = async () => {
    if (busy || count < 1) return
    if (balance < count) { setTopupOpen(true); return }
    setBusy(true)
    try {
      const res = await managers.messages.sendStarReaction(chatId, msgId, count, !showName)
      useMessagesStore.getState().applyStarReaction(chatId, msgId, res.total, res.mine)
      useStarsStore.getState().setBalance(res.balance)
      onClose()
    } catch {
      // Нехватка звёзд на сервере (гонка баланса) → предложить пополнение.
      setTopupOpen(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Popup
        open={open && !topupOpen}
        title={t('Star Reaction')}
        onClose={onClose}
        headerRight={
          <span className={s.balance}>
            <StarIcon size={18} />
            {balance}
          </span>
        }
        footer={
          <Button fullWidth onClick={() => void send()} disabled={busy}>
            <span className={s.sendLabel}>
              {t('Send')} {count} <StarIcon size={17} />
            </span>
          </Button>
        }
      >
        <div className={s.body}>
          <div className={s.count}>
            <StarIcon size={28} />
            <span>{count}</span>
          </div>
          <Slider value={count} min={1} max={MAX_STARS} step={1} onChange={setCount} className={s.slider} />
          <Text size={14} color="var(--tg-textSecondary)" className={s.subtitle}>
            {t('Choose how many Stars you want to send to support this message.')}
          </Text>

          {top.length > 0 && (
            <div className={s.senders}>
              <div className={s.sendersTitle}>
                <span className={s.line} />
                <Text size={13} color="var(--tg-textSecondary)">{t('Top Senders')}</Text>
                <span className={s.line} />
              </div>
              <div className={s.sendersList}>
                {top.map((snd, i) => (
                  <div key={i} className={s.sender}>
                    <div className={s.senderAvatar}>
                      {snd.anonymous
                        ? <Avatar background="var(--tg-textFaint)" text="?" size={56} />
                        : <Avatar background={peerColor(snd.name)} text={snd.name[0] ?? '?'} src={snd.avatarUrl || undefined} size={56} />}
                      <span className={s.senderAmount}>
                        <StarIcon size={12} />
                        {snd.stars}
                      </span>
                    </div>
                    <Text noWrap size={12.5} color="var(--tg-textPrimary)" className={s.senderName}>
                      {snd.anonymous ? t('Anonymous') : snd.name}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          )}

          <label className={s.anon}>
            <div onClick={() => setShowName((v) => !v)} style={{ cursor: 'pointer' }}>
              <Checkbox checked={showName} />
            </div>
            <Text size={14.5} color="var(--tg-textPrimary)">{t('Show my name')}</Text>
          </label>
        </div>
      </Popup>
      <StarsPopup open={topupOpen} onClose={() => setTopupOpen(false)} />
    </>
  )
}
