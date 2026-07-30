// group/screens/InviteLinkScreens.tsx
// Кластер пригласительных ссылок (tweb chatInviteLinks / editChatInviteLink /
// chatInviteLink): список ссылок, создание/редактирование и детали со списком
// вступивших.
import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Text from '../../../shared/ui/Text'
import IconButton from '../../../shared/ui/IconButton'
import Input from '../../../shared/ui/Input'
import Slider from '../../../shared/ui/Slider'
import Spinner from '../../../shared/ui/Spinner'
import TgIcon from '../../TgIcon'
import LottieSticker from '../../LottieSticker'
import ConfirmDialog from '../../settings/ConfirmDialog'
import { useT } from '../../../i18n'
import type { GroupEdit, ImporterRow } from '../../../core/hooks/useGroupEdit'
import type { InviteLink } from '../../../core/managers/groupsManager'
import UserAvatar from '../../UserAvatar'
import s from '../GroupEditFlow.module.scss'

// expiryLabel описывает срок действия ссылки: «истекла» для прошедшей даты,
// «истекает <дата>» для будущей, пусто — бессрочная.
function expiryLabel(t: (k: string) => string, expiresAt?: string): string | undefined {
  if (!expiresAt) return undefined
  const ts = Date.parse(expiresAt)
  if (Number.isNaN(ts)) return undefined
  if (ts <= Date.now()) return t('Expired')
  return `${t('Expires')} ${new Date(ts).toLocaleDateString()}`
}

// Подзаголовок строки ссылки (tweb createRow: joins • limit • expiry).
function linkSubtitle(t: (k: string) => string, l: InviteLink): string {
  if (l.revoked) return t('revoked')
  const parts: string[] = []
  if (l.uses > 0) {
    parts.push(`${l.uses} ${t('joined')}`)
    if (l.usageLimit != null && l.uses >= l.usageLimit) parts.push(t('Limit reached'))
    else if (l.usageLimit != null) parts.push(`${l.usageLimit - l.uses} ${t('remaining')}`)
  } else if (l.usageLimit != null) {
    parts.push(`${t('can join')} ${l.usageLimit}`)
  }
  const exp = expiryLabel(t, l.expiresAt)
  if (exp) parts.push(exp)
  if (!parts.length && l.requiresApproval) parts.push(t('Request Admin Approval'))
  return parts.join(' • ')
}

// ── Пригласительные ссылки (tweb chatInviteLinks) ────────────────────────────
export function InviteLinksScreen({ g, isChannel, onBack }: { g: GroupEdit; isChannel: boolean; onBack: () => void }) {
  const t = useT()
  const [copied, setCopied] = useState<string | null>(null)
  const [editing, setEditing] = useState<InviteLink | 'new' | null>(null)
  const [detail, setDetail] = useState<InviteLink | null>(null)
  const [revoking, setRevoking] = useState<InviteLink | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)

  const active = g.invites.filter((l) => !l.revoked)
  const revoked = g.revokedInvites
  const primary = active[0]
  const additional = active.slice(1)

  const copy = (token: string, url: string) => {
    void navigator.clipboard.writeText(url)
    setCopied(token)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <SettingsScreen title="Invite Links" onBack={onBack} zIndex={70}>
      <div className={s.duck}>
        <LottieSticker name="UtyanLinks" size={120} loop />
        <Text size={14.5} color="var(--tg-textSecondary)" className={s.duckCaption}>
          {isChannel
            ? t('Anyone who has Telegram installed will be able to join your channel by following this link.')
            : t('Anyone who has Telegram installed will be able to join your group by following this link.')}
        </Text>
      </div>

      <Section caption="Invite Link">
        {primary ? (
          <>
            <div className={s.linkBox} onClick={() => copy(primary.token, primary.url)}>
              <Text size={15.5} color="var(--tg-link)" style={{ wordBreak: 'break-all' }}>{primary.url}</Text>
              <Text size={13} color={copied === primary.token ? 'var(--tg-accent)' : 'var(--tg-textFaint)'}>
                {copied === primary.token ? t('Link copied to clipboard.') : t('Copy Link')}
              </Text>
            </div>
            <Row
              icon={<TgIcon name="admin" size={22} />}
              label={linkSubtitle(t, primary) || t('View link')}
              translate={false}
              chevron
              onClick={() => setDetail(primary)}
            />
            <Row
              icon={<TgIcon name="delete" size={22} color="#ff595a" />}
              label="Revoke Link"
              danger
              onClick={() => setRevoking(primary)}
            />
          </>
        ) : (
          <Row icon={<TgIcon name="plus" size={22} color="var(--tg-accent)" />} label="Create a New Link" accent onClick={() => setEditing('new')} />
        )}
      </Section>

      <Section caption="Additional Links" footer="You can create additional invite links that are limited by time, number of users, or require a paid subscription.">
        <Row icon={<TgIcon name="plus" size={22} color="var(--tg-accent)" />} label="Create a New Link" accent onClick={() => setEditing('new')} />
        {additional.map((l) => (
          <Row
            key={l.token}
            icon={<TgIcon name="link" size={22} color="var(--tg-textFaint)" />}
            label={l.title || l.url.replace(/^https?:\/\//, '')}
            translate={false}
            sublabel={linkSubtitle(t, l) || undefined}
            chevron
            onClick={() => setDetail(l)}
          />
        ))}
      </Section>

      {revoked.length > 0 && (
        <Section caption="Revoked Links">
          <Row icon={<TgIcon name="delete" size={22} color="#ff595a" />} label="Delete All Revoked Links" danger onClick={() => setDeletingAll(true)} />
          {revoked.map((l) => (
            <Row
              key={l.token}
              icon={<TgIcon name="link" size={22} color="var(--tg-textFaint)" />}
              label={l.title || l.url.replace(/^https?:\/\//, '')}
              translate={false}
              sublabel={t('revoked')}
              chevron
              onClick={() => setDetail(l)}
            />
          ))}
        </Section>
      )}

      {revoking && (
        <ConfirmDialog
          title={t('Revoke Link')}
          text={t('Are you sure you want to revoke this link? Once the link is revoked, no one will be able to join using it.')}
          action={t('Revoke')}
          danger
          zIndex={90}
          onConfirm={() => void g.editInvite(revoking.token, { revoked: true })}
          onClose={() => setRevoking(null)}
        />
      )}
      {deletingAll && (
        <ConfirmDialog
          title={t('Delete All Revoked Links')}
          text={t('Are you sure you want to delete all revoked links?')}
          action={t('Delete')}
          danger
          zIndex={90}
          onConfirm={() => void g.deleteAllRevoked()}
          onClose={() => setDeletingAll(false)}
        />
      )}

      <AnimatePresence>
        {editing && (
          <EditInviteLinkScreen
            g={g}
            link={editing === 'new' ? null : editing}
            onBack={() => setEditing(null)}
          />
        )}
        {detail && (
          <InviteLinkDetailScreen
            g={g}
            link={detail}
            onEdit={() => { setEditing(detail); setDetail(null) }}
            onBack={() => setDetail(null)}
          />
        )}
      </AnimatePresence>
    </SettingsScreen>
  )
}

// Шаги «Limit by Period» (tweb stepValues 1h/1d/1w + ∞). undefined — бессрочно.
const PERIOD_STEPS: (number | undefined)[] = [3600, 86400, 604800, undefined]
const periodLabel = (v: number | undefined): string =>
  v === undefined ? '∞' : v < 86400 ? '1 hour' : v < 604800 ? '1 day' : '1 week'
// Шаги «Limit Number of Uses» (tweb 1/10/50/100 + ∞). undefined — без лимита.
const USES_STEPS: (number | undefined)[] = [1, 10, 50, 100, undefined]
const usesLabel = (v: number | undefined): string => (v === undefined ? '∞' : String(v))

const closestStep = (steps: (number | undefined)[], value: number): number => {
  let bestIdx = 0
  let bestDiff = Infinity
  steps.forEach((sv, i) => {
    if (sv === undefined) return
    const diff = Math.abs(sv - value)
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i }
  })
  return bestIdx
}

// ── Создание/редактирование ссылки (tweb editChatInviteLink) ─────────────────
function EditInviteLinkScreen({ g, link, onBack }: { g: GroupEdit; link: InviteLink | null; onBack: () => void }) {
  const t = useT()
  const [name, setName] = useState(link?.title ?? '')
  const [periodIdx, setPeriodIdx] = useState(() => {
    if (!link?.expiresAt) return PERIOD_STEPS.length - 1
    const remaining = (Date.parse(link.expiresAt) - Date.now()) / 1000
    return remaining > 0 ? closestStep(PERIOD_STEPS, remaining) : PERIOD_STEPS.length - 1
  })
  const [approval, setApproval] = useState(link?.requiresApproval ?? false)
  const [usesIdx, setUsesIdx] = useState(() => (link?.usageLimit != null ? closestStep(USES_STEPS, link.usageLimit) : USES_STEPS.length - 1))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (saving) return
    setSaving(true)
    const expireSeconds = PERIOD_STEPS[periodIdx] ?? 0
    const usageLimit = approval ? undefined : USES_STEPS[usesIdx]
    try {
      if (link) {
        await g.editInvite(link.token, { title: name, requiresApproval: approval, expireSeconds, usageLimit: usageLimit ?? null })
      } else {
        await g.createInvite({ title: name || undefined, requiresApproval: approval, expireSeconds: expireSeconds || undefined, usageLimit })
      }
      onBack()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsScreen
      title={link ? 'Edit Link' : 'New Link'}
      onBack={onBack}
      zIndex={80}
      headerRight={
        <IconButton onClick={() => void save()} color="var(--tg-accent)">
          {saving ? <Spinner size={22} /> : <TgIcon name="check" />}
        </IconButton>
      }
    >
      <Section caption="Link Name" footer="Only admins will see this name.">
        <Input label={t('Link Name (Optional)')} value={name} onChange={setName} maxLength={32} wrapClassName={s.field} />
      </Section>

      <Section caption="Limit by Period" footer="You can make the link expire after a certain time.">
        <div className={s.slowmode}>
          <div className={s.slowLabels}>
            {PERIOD_STEPS.map((v, i) => (
              <span key={i} className={i === periodIdx ? s.slowActive : undefined}>{periodLabel(v)}</span>
            ))}
          </div>
          <Slider min={0} max={PERIOD_STEPS.length - 1} step={1} value={periodIdx} onChange={setPeriodIdx} />
        </div>
      </Section>

      <Section>
        <Row label="Request Admin Approval" toggle checked={approval} onClick={() => setApproval((v) => !v)} />
      </Section>

      {!approval && (
        <Section caption="Limit Number of Uses" footer="You can make the link work only for a certain number of users.">
          <div className={s.slowmode}>
            <div className={s.slowLabels}>
              {USES_STEPS.map((v, i) => (
                <span key={i} className={i === usesIdx ? s.slowActive : undefined}>{usesLabel(v)}</span>
              ))}
            </div>
            <Slider min={0} max={USES_STEPS.length - 1} step={1} value={usesIdx} onChange={setUsesIdx} />
          </div>
        </Section>
      )}
    </SettingsScreen>
  )
}

// ── Детали ссылки (tweb chatInviteLink): ссылка + список вступивших ──────────
function InviteLinkDetailScreen({ g, link, onEdit, onBack }: { g: GroupEdit; link: InviteLink; onEdit: () => void; onBack: () => void }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [importers, setImporters] = useState<ImporterRow[]>([])
  const [revoking, setRevoking] = useState(false)

  useEffect(() => {
    let alive = true
    if (link.uses > 0) void g.loadImporters(link.token).then((rows) => { if (alive) setImporters(rows) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.token])

  const copy = () => {
    void navigator.clipboard.writeText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <SettingsScreen title={link.title || 'Invite Link'} onBack={onBack} zIndex={80}>
      <Section caption="Invite Link">
        <div className={s.linkBox} onClick={copy}>
          <Text size={15.5} color="var(--tg-link)" style={{ wordBreak: 'break-all' }}>{link.url}</Text>
          <Text size={13} color={copied ? 'var(--tg-accent)' : 'var(--tg-textFaint)'}>
            {copied ? t('Link copied to clipboard.') : t('Copy Link')}
          </Text>
        </div>
      </Section>

      {link.usageLimit != null && link.uses === 0 && (
        <Section>
          <Text size={14.5} color="var(--tg-textSecondary)" style={{ padding: '8px 16px' }}>
            {`${link.usageLimit} ${t('people can join via this link.')}`}
          </Text>
        </Section>
      )}

      {importers.length > 0 && (
        <Section caption={`${link.uses} ${t('joined')}`}>
          {importers.map((im) => (
            <div key={im.userId} className={s.memberRow}>
              <UserAvatar id={im.userId} name={im.name} avatarUrl={im.avatarUrl} />
              <div className={s.memberBody}>
                <Text noWrap size={16} color="var(--tg-textPrimary)">{im.name}</Text>
                <Text noWrap size={14} color="var(--tg-textSecondary)">{new Date(im.joinedAt).toLocaleDateString()}</Text>
              </div>
            </div>
          ))}
        </Section>
      )}

      {!link.revoked ? (
        <Section>
          <Row icon={<TgIcon name="edit" size={22} />} label="Edit Link" onClick={onEdit} />
          <Row icon={<TgIcon name="delete" size={22} color="#ff595a" />} label="Revoke Link" danger onClick={() => setRevoking(true)} />
        </Section>
      ) : (
        <Section>
          <Row icon={<TgIcon name="delete" size={22} color="#ff595a" />} label="Delete Link" danger onClick={() => void g.deleteInvite(link.token).then(onBack)} />
        </Section>
      )}

      {revoking && (
        <ConfirmDialog
          title={t('Revoke Link')}
          text={t('Are you sure you want to revoke this link? Once the link is revoked, no one will be able to join using it.')}
          action={t('Revoke')}
          danger
          zIndex={90}
          onConfirm={() => void g.editInvite(link.token, { revoked: true }).then(onBack)}
          onClose={() => setRevoking(false)}
        />
      )}
    </SettingsScreen>
  )
}
