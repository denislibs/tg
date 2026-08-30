import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { SettingsScreen, Section, Row } from './settings/kit'
import { useT } from '../i18n'
import { usePremiumSubscription } from '../core/hooks/usePremiumSubscription'
import { planById, formatUsd } from '../core/premium/plans'

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
  const { sub, loading, cancelling, cancel } = usePremiumSubscription()

  return (
    <SettingsScreen title="Premium.Boarding.Title" onBack={onBack} zIndex={70}>
      <div style={{ textAlign: 'center', padding: '12px 0 20px' }}>
        <TgIcon name="star_filled" size={64} color="var(--primary-color)" />
        <Text size={20} weight={600} color="var(--primary-text-color)" style={{ marginTop: 8 }}>
          {t('Premium.Manage.Active')}
        </Text>
      </div>

      {loading ? (
        <Text size={15} color="var(--secondary-text-color)" style={{ textAlign: 'center', padding: 20 }}>
          {t('Loading')}
        </Text>
      ) : sub ? (
        <>
          <Section caption="Stars.Subscription">
            <Row label={t(planById(sub.plan).labelKey)} value={formatUsd(sub.priceCents)} translate={false} />
            <Row
              label={sub.autoRenew ? 'Premium.Manage.RenewsOn' : 'Premium.Manage.ExpiresOn'}
              value={formatDate(sub.expiresAt)}
              translate
            />
          </Section>

          {sub.autoRenew ? (
            <Section footer="Premium.Manage.Hint">
              <Row
                icon={<TgIcon name="close" size={24} color="#ff595a" />}
                label={cancelling ? 'Premium.Manage.Cancelling' : 'Stars.Subscription.Cancel'}
                danger
                onClick={() => void cancel()}
              />
            </Section>
          ) : (
            <Section footer="Premium.Manage.AutoRenewOffHint">
              <Row label="Premium.Manage.AutoRenew" value={t('Off')} translate={false} />
            </Section>
          )}
        </>
      ) : (
        <Text size={15} color="var(--secondary-text-color)" style={{ textAlign: 'center', padding: 20 }}>
          {t('Premium.Manage.NoSubscription')}
        </Text>
      )}
    </SettingsScreen>
  )
}
