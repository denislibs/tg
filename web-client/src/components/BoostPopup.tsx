// Попап буста канала — порт tweb popups/boost.ts: полоса прогресса уровня
// (Level N → Level N+1, заполнение = доля до следующего уровня, плавающая
// подсказка со счётчиком бустов), заголовок/описание и кнопка «Boost Channel».
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useChannelBoosts } from '../core/hooks/useChannelBoosts'
import { boostedByMe, boostProgress } from '../core/boosts/boostsStatus'
import { useT, useTArgs } from '../i18n'
import s from './BoostPopup.module.scss'

export default function BoostPopup({ chatId, onClose }: { chatId: number; onClose: () => void }) {
  const t = useT()
  const tArgs = useTArgs()
  const { boosts: channelBoosts, boost } = useChannelBoosts(chatId)
  const status = channelBoosts?.status
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const level = status?.level ?? 0
  const boosts = status?.boosts ?? 0
  const { progress, need } = boostProgress(status)
  const mine = boostedByMe(status)

  const doBoost = () => {
    if (busy) return
    setBusy(true)
    setErr('')
    void boost()
      .catch(() => setErr(t('Boost.Error.NoSlot')))
      .finally(() => setBusy(false))
  }

  const description = mine
    ? t('Boost.AlreadyBoosting')
    : need > 0
      ? tArgs('MoreBoosts', [need])
      : t('Boost.Subtitle')

  return (
    <Popup open title={t('BoostChannel')} onClose={onClose} width={360}>
      <div className={s.body}>
        <div className={s.bar}>
          <div className={s.hint} style={{ left: `${Math.min(Math.max(progress * 100, 10), 90)}%` }}>
            <TgIcon name="boost" size={13} color="#fff" />
            <span>{boosts}</span>
          </div>
          <div className={s.track}>
            <div className={s.fill} style={{ width: `${progress * 100}%` }} />
          </div>
          <div className={s.levels}>
            <span>{t('BoostsLevel2')} {level}</span>
            <span>{t('BoostsLevel2')} {level + 1}</span>
          </div>
        </div>

        <Text size={15} color="var(--primary-text-color)" className={s.desc}>{description}</Text>

        {err && <Text size={13} color="#e5484d" className={s.desc}>{err}</Text>}

        {mine ? (
          <div className={s.boosted}>✓ {t('Boost.Boosted')}</div>
        ) : (
          <button className={s.btn} disabled={busy} onClick={doBoost}>
            <TgIcon name="boost" size={18} color="#fff" />
            {t('BoostChannel')}
          </button>
        )}
      </div>
    </Popup>
  )
}
