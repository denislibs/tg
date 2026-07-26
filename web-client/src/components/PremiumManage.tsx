import { useEffect, useState } from 'react'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { SettingsScreen, Section, Row } from './settings/kit'
import { useT } from '../i18n'
import { useManagers } from '../core/hooks/useManagers'
import { planById, formatUsd } from '../core/premium/plans'
import type { PremiumSubscription } from '../core/managers/premiumManager'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

// Manage-subscription screen (tweb settings sub-screen): shows the active plan,
// its expiry and auto-renew state, and lets the user cancel auto-renew.
export default function PremiumManage({ onBack }: { onBack: () => void }) {
  const t = useT()
  const managers = useManagers()
  const [sub, setSub] = useState<PremiumSubscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    let alive = true
    void managers.premium.getSubscription().then((s) => {
      if (alive) {
        setSub(s)
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [managers])

  const cancel = async () => {
    if (cancelling) return
    setCancelling(true)
    try {
      setSub(await managers.premium.cancelSubscription())
    } finally {
      setCancelling(false)
    }
  }

  return (
    <SettingsScreen title="Telegram Premium" onBack={onBack} zIndex={70}>
      <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
        <TgIcon name="star_filled" size={64} color="var(--tg-accent)" />
        <Text size={20} weight={600} color="var(--tg-textPrimary)" style={{ marginTop: 8 }}>
          {t('You have Telegram Premium')}
        </Text>
      </div>

      {loading ? (
        <Text size={15} color="var(--tg-textSecondary)" style={{ textAlign: 'center', padding: 20 }}>
          {t('Loading…')}
        </Text>
      ) : sub ? (
        <>
          <Section caption="Subscription">
            <Row label={t(planById(sub.plan).labelKey)} value={formatUsd(sub.priceCents)} translate={false} />
            <Row
              label={sub.autoRenew ? 'Renews on' : 'Expires on'}
              value={formatDate(sub.expiresAt)}
              translate
            />
          </Section>

          {sub.autoRenew ? (
            <Section footer="Your subscription renews automatically. Cancel to stop future charges — Premium stays active until it expires.">
              <Row
                icon={<TgIcon name="close" size={24} color="#ff595a" />}
                label={cancelling ? 'Cancelling…' : 'Cancel Subscription'}
                danger
                onClick={() => void cancel()}
              />
            </Section>
          ) : (
            <Section footer="Auto-renew is off. Your Premium subscription will end on the date above.">
              <Row label="Auto-Renew" value={t('Off')} translate={false} />
            </Section>
          )}
        </>
      ) : (
        <Text size={15} color="var(--tg-textSecondary)" style={{ textAlign: 'center', padding: 20 }}>
          {t('No active subscription.')}
        </Text>
      )}
    </SettingsScreen>
  )
}
