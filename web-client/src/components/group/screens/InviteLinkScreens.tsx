// group/screens/InviteLinkScreens.tsx
// Кластер пригласительных ссылок (tweb chatInviteLinks / editChatInviteLink /
// chatInviteLink): список ссылок, создание/редактирование и детали со списком
// вступивших.
import type { LangPackKey } from '@/lang'
import { useEffect, useState } from 'react'
import { SettingsScreen, Section, Row } from '../../settings/kit'
import Text from '../../../shared/ui/Text'
import IconButton from '../../../shared/ui/IconButton'
import Input from '../../../shared/ui/Input'
import Slider from '../../../shared/ui/Slider'
import Spinner from '../../../shared/ui/Spinner'
import TgIcon from '../../TgIcon'
import LottieSticker from '../../LottieSticker'
import ConfirmDialog from '../../settings/ConfirmDialog'
import classNames from '../../../shared/lib/classNames'
import { useT, useTArgs } from '../../../i18n'
import type { GroupEdit, ImporterRow } from '../../../core/hooks/useGroupEdit'
import type { InviteLink } from '../../../core/managers/groupsManager'
import UserAvatar from '../../UserAvatar'
import { SentTime } from '../../../shared/ui/dateNodes'
import I18n from '@lib/langPack'

/**
 * expiryLabel описывает срок действия ссылки: «истекла» для прошедшей даты,
 * «истекает <дата>» для будущей, пусто — бессрочная.
 *
 * Дата берётся у ЯДРА (`I18n.getDateTimeFormat` — тот же кэш форматтеров, что у
 * `IntlDateElement`); прежде здесь стоял `toLocaleDateString()` вовсе без
 * аргументов, то есть локаль БРАУЗЕРА.
 *
 * РАСХОЖДЕНИЕ С ОРИГИНАЛОМ, и оно не в формате, а в самой подписи: tweb на этом
 * месте показывает не дату, а ОБРАТНЫЙ ОТСЧЁТ — `InviteLink.Sticker.TimeLeft`
 * с длительностью (`chatInviteLinks.tsx:459`) и кольцом прогресса рядом. Порт
 * этого — отдельная работа (там своя механика цвета и `strokeDasharray`), а не
 * правка одной строки. Строкой, а не узлом, дата остаётся вынужденно: результат
 * склеивается в подзаголовок через ' • ' и в этом же виде едет в `Row label`,
 * который у нас `string` (раскол контракта — задача #112).
 */
function expiryLabel(t: (key: LangPackKey) => string, expiresAt?: string): string | undefined {
  if (!expiresAt) return undefined
  const ts = Date.parse(expiresAt)
  if (Number.isNaN(ts)) return undefined
  if (ts <= Date.now()) return t('ExportedInvitation.Status.Expired')
  return `${t('InviteLinks.Expires')} ${I18n.getDateTimeFormat({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ts))}`
}

// Подзаголовок строки ссылки (tweb createRow: joins • limit • expiry).
function linkSubtitle(t: (key: LangPackKey) => string, tArgs: (key: LangPackKey, args: (string | number)[]) => string, l: InviteLink): string {
  if (l.revoked) return t('ExportedInvitation.Status.Revoked')
  const parts: string[] = []
  if (l.uses > 0) {
    parts.push(tArgs('PeopleJoined', [l.uses]))
    if (l.usageLimit != null && l.uses >= l.usageLimit) parts.push(t('InviteLinks.LimitReached'))
    else if (l.usageLimit != null) parts.push(tArgs('PeopleJoinedRemaining', [l.usageLimit - l.uses]))
  } else if (l.usageLimit != null) {
    // Число ВНУТРИ строки (ключ оригинала `CanJoin`), а не приклеено в коде: склейка
    // «суффикс + число» печатала суффикс префиксом («могут вступить 5»).
    parts.push(tArgs('CanJoin', [l.usageLimit]))
  }
  const exp = expiryLabel(t, l.expiresAt)
  if (exp) parts.push(exp)
  if (!parts.length && l.requiresApproval) parts.push(t('ApproveNewMembers'))
  return parts.join(' • ')
}

// ── Пригласительные ссылки (tweb chatInviteLinks) ────────────────────────────
export function InviteLinksScreen({ g, isChannel, onBack }: { g: GroupEdit; isChannel: boolean; onBack: () => void }) {
  const t = useT()
  const tArgs = useTArgs()
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
    <SettingsScreen
      title="InviteLinks"
      onBack={onBack}
      zIndex={70}
      sub={editing ? (
        <EditInviteLinkScreen
          g={g}
          link={editing === 'new' ? null : editing}
          onBack={() => setEditing(null)}
        />
      ) : detail ? (
        <InviteLinkDetailScreen
          g={g}
          link={detail}
          onEdit={() => { setEditing(detail); setDetail(null) }}
          onBack={() => setDetail(null)}
        />
      ) : null}
    >
      {/* Заглушка-стикер с подписью — как в tweb: медиа-шапка секции
          (`.sticker-container`) и подпись `sidebar-left-section-caption`. */}
      <div className="sidebar-left-section-container">
        <div className="sidebar-left-section no-delimiter">
          <div className="sidebar-left-section-content sticker-container">
            <LottieSticker name="UtyanLinks" size={120} loop />
          </div>
          <div className="sidebar-left-section-content sidebar-left-section-caption">
            {isChannel
              ? t('ChannelLinkInfo')
              : t('InviteLinks.Description.Group')}
          </div>
        </div>
      </div>

      <Section caption="InviteLink">
        {primary ? (
          <>
            <Row
              label={primary.url}
              sublabel={copied === primary.token ? t('LinkCopied') : t('CopyLink')}
              translate={false}
              onClick={() => copy(primary.token, primary.url)}
            />
            <Row
              icon={<TgIcon name="admin" size={22} />}
              label={linkSubtitle(t, tArgs, primary) || t('InviteLinks.View')}
              translate={false}
              onClick={() => setDetail(primary)}
            />
            <Row
              icon={<TgIcon name="delete" size={22} color="#ff595a" />}
              label="RevokeLink"
              danger
              onClick={() => setRevoking(primary)}
            />
          </>
        ) : (
          <Row icon={<TgIcon name="plus" size={22} color="var(--primary-color)" />} label="CreateNewLink" accent onClick={() => setEditing('new')} />
        )}
      </Section>

      <Section caption="InviteLinks.Additional" footer="InviteLinks.Description.Additional">
        <Row icon={<TgIcon name="plus" size={22} color="var(--primary-color)" />} label="CreateNewLink" accent onClick={() => setEditing('new')} />
        {additional.map((l) => (
          <Row
            key={l.token}
            icon={<TgIcon name="link" size={22} color="var(--secondary-text-color)" />}
            label={l.title || l.url.replace(/^https?:\/\//, '')}
            translate={false}
            sublabel={linkSubtitle(t, tArgs, l) || undefined}
            onClick={() => setDetail(l)}
          />
        ))}
      </Section>

      {revoked.length > 0 && (
        <Section caption="RevokedLinks">
          <Row icon={<TgIcon name="delete" size={22} color="#ff595a" />} label="DeleteAllRevokedLinks" danger onClick={() => setDeletingAll(true)} />
          {revoked.map((l) => (
            <Row
              key={l.token}
              icon={<TgIcon name="link" size={22} color="var(--secondary-text-color)" />}
              label={l.title || l.url.replace(/^https?:\/\//, '')}
              translate={false}
              sublabel={t('ExportedInvitation.Status.Revoked')}
              onClick={() => setDetail(l)}
            />
          ))}
        </Section>
      )}

      {revoking && (
        <ConfirmDialog
          title="RevokeLink"
          text="RevokeAlert"
          action="RevokeButton"
          danger
          zIndex={90}
          onConfirm={() => void g.editInvite(revoking.token, { revoked: true })}
          onClose={() => setRevoking(null)}
        />
      )}
      {deletingAll && (
        <ConfirmDialog
          title="DeleteAllRevokedLinks"
          text="ManageLinks.DeleteAll.Confirm"
          action="Delete"
          danger
          zIndex={90}
          onConfirm={() => void g.deleteAllRevoked()}
          onClose={() => setDeletingAll(false)}
        />
      )}

    </SettingsScreen>
  )
}

// Шаги «Limit by Period» (tweb stepValues 1h/1d/1w + ∞). undefined — бессрочно.
const PERIOD_STEPS: (number | undefined)[] = [3600, 86400, 604800, undefined]
// Подпись шага — форма числа, как у оригинала (`wrapFormattedDuration` →
// `DURATION_LANG_KEYS`, wrapDuration.ts:5-13). Прежние `Duration.Days1`/`Duration.Weeks1`
// ключами БЫТЬ ПЕРЕСТАЛИ (волна свела их в `Days`/`Weeks`), и подпись доезжала до экрана
// именем ключа; «1 hour» рядом было английским литералом.
const periodLabel = (v: number | undefined, tArgs: (key: LangPackKey, args: (string | number)[]) => string): string =>
  v === undefined ? '∞'
    : v < 86400 ? tArgs('Hours', [1])
      : v < 604800 ? tArgs('Days', [1]) : tArgs('Weeks', [1])
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
  const tArgs = useTArgs()
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
      title={link ? 'InviteLinks.Edit' : 'NewLink'}
      onBack={onBack}
      zIndex={80}
      headerRight={
        <IconButton onClick={() => void save()} color="var(--primary-color)">
          {saving ? <Spinner size={22} /> : <TgIcon name="check" />}
        </IconButton>
      }
    >
      <Section caption="InviteLinks.NameLabel" footer="LinkNameHelp">
        <div className="input-wrapper">
          <Input label={t('LinkNameHint')} value={name} onChange={setName} maxLength={32} />
        </div>
      </Section>

      <Section caption="InviteLinks.LimitPeriod" footer="InviteLinks.TimeLimitHelp">
        {/* Ступенчатый селектор — `range-setting-selector.range-steps-selector`
            с засечками `.range-setting-selector-option` (дамп 15-right-13). */}
        <div className="range-setting-selector range-steps-selector">
          <Slider min={0} max={PERIOD_STEPS.length - 1} step={1} value={periodIdx} onChange={setPeriodIdx} style={{ marginBlock: 0 }}>
            {PERIOD_STEPS.map((v, i) => (
              <div
                key={i}
                className={classNames(
                  'range-setting-selector-option',
                  i === periodIdx ? 'active is-chosen' : '',
                  i === 0 ? 'is-first' : '',
                  i === PERIOD_STEPS.length - 1 ? 'is-last' : '',
                )}
                style={{ left: `${(i / (PERIOD_STEPS.length - 1)) * 100}%` }}
              >
                <div className="range-setting-selector-option-text">{periodLabel(v, tArgs)}</div>
              </div>
            ))}
          </Slider>
        </div>
      </Section>

      <Section>
        <Row label="ApproveNewMembers" toggle checked={approval} onClick={() => setApproval((v) => !v)} />
      </Section>

      {!approval && (
        <Section caption="InviteLinks.LimitUses" footer="InviteLinks.UsesLimitHelp">
        {/* Ступенчатый селектор — `range-setting-selector.range-steps-selector`
              с засечками `.range-setting-selector-option` (дамп 15-right-13). */}
          <div className="range-setting-selector range-steps-selector">
            <Slider min={0} max={USES_STEPS.length - 1} step={1} value={usesIdx} onChange={setUsesIdx} style={{ marginBlock: 0 }}>
              {USES_STEPS.map((v, i) => (
                <div
                  key={i}
                  className={classNames(
                    'range-setting-selector-option',
                    i === usesIdx ? 'active is-chosen' : '',
                    i === 0 ? 'is-first' : '',
                    i === USES_STEPS.length - 1 ? 'is-last' : '',
                  )}
                  style={{ left: `${(i / (USES_STEPS.length - 1)) * 100}%` }}
                >
                  <div className="range-setting-selector-option-text">{usesLabel(v)}</div>
                </div>
              ))}
            </Slider>
          </div>
        </Section>
      )}
    </SettingsScreen>
  )
}

// ── Детали ссылки (tweb chatInviteLink): ссылка + список вступивших ──────────
function InviteLinkDetailScreen({ g, link, onEdit, onBack }: { g: GroupEdit; link: InviteLink; onEdit: () => void; onBack: () => void }) {
  const t = useT()
  const tArgs = useTArgs()
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
    <SettingsScreen title={link.title ? undefined : 'InviteLink'} titleText={link.title} onBack={onBack} zIndex={80}>
      <Section caption="InviteLink">
        <Row
          label={link.url}
          sublabel={copied ? t('LinkCopied') : t('CopyLink')}
          translate={false}
          onClick={copy}
        />
      </Section>

      {link.usageLimit != null && link.uses === 0 && (
        <Section>
          <Text size={14.5} color="var(--secondary-text-color)" style={{ padding: '8px 16px' }}>
            {tArgs('PeopleCanJoinViaLinkCount', [link.usageLimit])}
          </Text>
        </Section>
      )}

      {importers.length > 0 && (
        <Section captionText={tArgs('PeopleJoined', [link.uses])}>
          {/* Дата вступления — узел `formatFullSentTime` оригинала
              (`chatInviteLink.tsx:235`: `getSubtitleForElement: (peerId) =>
              formatFullSentTime(importersMap.get(peerId)?.date)`). Прежний
              `toLocaleDateString()` был вовсе без аргументов — локаль БРАУЗЕРА. */}
          {importers.map((im) => (
            <Row
              key={im.userId}
              icon={<UserAvatar id={im.userId} name={im.name} photoId={im.photoId} />}
              label={im.name}
              sublabel={<SentTime timestamp={Math.floor(Date.parse(im.joinedAt) / 1000)} />}
              translate={false}
            />
          ))}
        </Section>
      )}

      {!link.revoked ? (
        <Section>
          <Row icon={<TgIcon name="edit" size={22} />} label="InviteLinks.Edit" onClick={onEdit} />
          <Row icon={<TgIcon name="delete" size={22} color="#ff595a" />} label="RevokeLink" danger onClick={() => setRevoking(true)} />
        </Section>
      ) : (
        <Section>
          <Row icon={<TgIcon name="delete" size={22} color="#ff595a" />} label="Delete Link" danger onClick={() => void g.deleteInvite(link.token).then(onBack)} />
        </Section>
      )}

      {revoking && (
        <ConfirmDialog
          title="RevokeLink"
          text="RevokeAlert"
          action="RevokeButton"
          danger
          zIndex={90}
          onConfirm={() => void g.editInvite(link.token, { revoked: true }).then(onBack)}
          onClose={() => setRevoking(false)}
        />
      )}
    </SettingsScreen>
  )
}
