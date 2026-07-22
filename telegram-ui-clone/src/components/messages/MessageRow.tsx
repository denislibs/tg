// src/components/messages/MessageRow.tsx
// ONE message bubble, memoized. Extracted from ConversationView's feed so that
// appending/sending a message re-renders only the new (and the previous-last,
// whose group tail flips) row — not all ~40 bubbles. memo() bails when its props
// are unchanged; this works because `m` (ConvMsg) is given a STABLE reference by
// the parent's conversion cache, and every other prop is a primitive or a stable
// callback object (feedFns). The media viewer is opened via context (useMediaViewer).
//
// Стили — MessageRow.module.scss; палитра исходящих/входящих через CSS-переменные
// на .row ([data-out]); геометрия с рантайм-флагами (радиусы, textSize) — инлайн.
import { memo, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import { withAlpha } from '../../core/cssColor'
import { mediaThumbUrl, hasMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import TgIcon from '../TgIcon'
import { BubbleAppear } from '../animations/bubbleAnimations'
import RealMediaBubble from './RealMediaBubble'
import SecretMediaBubble from './SecretMediaBubble'
import PollBubble from './PollBubble'
import GiftBubble from './GiftBubble'
import GiveawayBubble from './GiveawayBubble'
import InlineKeyboard from './InlineKeyboard'
import AlbumGrid from './AlbumGrid'
import VoiceMessage from './VoiceMessage'
import Checkbox from '../../shared/ui/Checkbox'
import {
  Ticks,
  BubbleTail,
  bubbleRadius,
  BUBBLE_R_BIG,
  BUBBLE_R_MED,
  DocumentBubble,
  AudioBubble,
  RoundVideoBubble,
  WebPagePreview,
  CallBubble,
  RoundVideoRealBubble,
  GeoBubble,
  ContactBubble,
  SecretTimer,
} from './MessageBubbles'
import RichText, { emojiOnlyCount } from '../RichText'
import Emoji from '../emoji/Emoji'
import StickerMedia from '../StickerMedia'
import { useAnimatedEmoji } from '../../core/hooks/useAnimatedEmoji'
import { effectForEmoji, playEmojiEffect, type EmojiEffectKind } from '../../core/effects/emojiEffects'
import { peerColor } from '../peerColor'
import { fmtViews } from '../../core/fmtViews'
import { useT } from '../../i18n'
import { useSettings, useTimeFormatter } from '../../settings'
import type { ConvMsg } from '../../data'
import type { ChatAutoDownload } from '../../core/hooks/useChatAutoDownload'
import s from './MessageRow.module.scss'

// Обёртка контента .zone: без плавающих реакций — прозрачна; с ними — колонка
// «бабл + строка чипов под ним» (tweb reactions-out у стикеров/кружков/голосовых).
function ZoneBody({ chipsOutside, children }: { chipsOutside: ReactNode; children: ReactNode }) {
  if (!chipsOutside) return <>{children}</>
  return (
    <div className={s.zoneCol}>
      {children}
      <div className={s.reactionsOut}>{chipsOutside}</div>
    </div>
  )
}

// Радиус media/voice-бабла: скруглён везде, кроме хвостового угла последнего в группе.
function mediaRadius(out: boolean, lastInGroup: boolean): string {
  const B = BUBBLE_R_BIG
  const last = lastInGroup ? 0 : BUBBLE_R_MED
  return out ? `${B}px ${B}px ${last}px ${B}px` : `${B}px ${B}px ${B}px ${last}px`
}

// The view-count span (count + eye icon) shown in a channel post's meta line.
function ViewsMeta({ views, className }: { views: number; className: string }) {
  return (
    <span className={className}>
      <TgIcon name="channelviews" size={15} color="var(--b-time)" />
      {fmtViews(views)}
    </span>
  )
}

// The forward-count span (count + forward icon) shown in a channel post's meta
// line, alongside the view count (tweb message.forwards / shares tooltip).
function ForwardsMeta({ forwards, className }: { forwards: number; className: string }) {
  return (
    <span className={className}>
      <TgIcon name="forward" size={15} color="var(--b-time)" />
      {fmtViews(forwards)}
    </span>
  )
}

// Эмодзи-глиф вида эффекта (наш аналог Telegram message effects) — для кнопки
// повторного проигрывания у бабла.
const EFFECT_EMOJI: Record<EmojiEffectKind, string> = {
  fireworks: '🎆', confetti: '🎉', hearts: '❤️', thumbs: '👍', poop: '💩', cake: '🎂',
}

// Кнопка повтора эффекта сообщения: клик запускает полноэкранный canvas-эффект
// из центра кнопки (tweb: тап по сообщению с эффектом переигрывает его).
function EffectReplayButton({ kind }: { kind: EmojiEffectKind }) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      className={s.effectReplay}
      onClick={(e) => {
        e.stopPropagation()
        const r = ref.current?.getBoundingClientRect()
        playEmojiEffect(kind, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined)
      }}
      aria-label="Replay message effect"
    >
      {EFFECT_EMOJI[kind]}
    </button>
  )
}

// Stable handler bundle the feed/rows close over (identities never change — see
// ConversationView's useEvent wrappers), so passing it through doesn't bust memo.
export interface FeedFns {
  openSender: (senderId: number, fallbackName: string) => void
  playVoice: (mediaId: number) => void
  toggleSelect: (id: number) => void
  openMsgMenu: (e: MouseEvent, m: ConvMsg) => void
  jumpToSeq: (seq?: number) => void
  openLightbox: (mediaId: number, el: HTMLElement) => void
  /** перезвонить по клику на бабл звонка (tweb: клик по messageMediaCall) */
  recall: (video: boolean) => void
  /** кружок воспроизведён со звуком → снять media_unread (tweb readMessages) */
  mediaPlayed: (msgId: number) => void
  /** кружок заиграл со звуком → его <video> становится треком глобального плеера */
  roundPlaying: (msgId: number, el: HTMLMediaElement) => void
  /** клик по чипу реакции — поставить/снять свою (tweb sendReaction) */
  toggleReaction: (msgId: number, emoji: string) => void
  /** long-press / правый клик по чипу — показать, кто отреагировал */
  showReactedUsers: (msgId: number, x: number, y: number) => void
  /** крестик на кольце прогресса — отменить аплоад и убрать оптимистичный бабл */
  cancelUpload: (clientId: string) => void
}

// Чипы реакций под сообщением (tweb ReactionsElement, layout Block): пилюля 30px
// с эмодзи + счётчиком; «моя» реакция — сплошной акцентный фон (is-chosen).
function MessageReactions({ reactions, rowLive, onToggle, onShow }: {
  reactions: NonNullable<ConvMsg['reactions']>
  /** ряд уже был смонтирован, когда появились реакции (live-добавление) —
   * анимируем и первый чип сообщения, не только добавленные позже */
  rowLive: boolean
  onToggle: (emoji: string) => void
  onShow: (x: number, y: number) => void
}) {
  // Отличаем чипы из первичного рендера (история — без анимации, tweb
  // isConnected=false → duration 0) от добавленных кликом (с анимацией).
  const liveRef = useRef(false)
  useEffect(() => { liveRef.current = true }, [])
  return (
    <div className={s.reactions}>
      {reactions.map((r) => (
        <ReactionChip key={r.emoji} r={r} live={rowLive || liveRef.current} onToggle={onToggle} onShow={onShow} />
      ))}
    </div>
  )
}

// Один чип. Свежедобавленная «моя» реакция монтируется без is-chosen и получает
// класс кадром позже — CSS-transition подложки играет как tweb SetTransition(300).
// Тап — тоггл своей реакции; long-press / правый клик — попап «кто отреагировал».
function ReactionChip({ r, live, onToggle, onShow }: {
  r: { emoji: string; count: number; mine: boolean }
  live: boolean
  onToggle: (emoji: string) => void
  onShow: (x: number, y: number) => void
}) {
  const [defer, setDefer] = useState(live && r.mine)
  useEffect(() => {
    if (!defer) return
    const raf = requestAnimationFrame(() => setDefer(false))
    return () => cancelAnimationFrame(raf)
  }, [defer])
  const chosen = r.mine && !defer
  return (
    <div
      className={classNames(s.reactionChip, chosen ? s.reactionChosen : '')}
      onClick={(e) => { e.stopPropagation(); onToggle(r.emoji) }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onShow(e.clientX, e.clientY) }}
    >
      <span className={s.reactionEmoji}><Emoji e={r.emoji} size={22} /></span>
      <span className={s.reactionCount}>{r.count}</span>
    </div>
  )
}

export interface MessageRowProps {
  m: ConvMsg
  seq?: number           // raw window seq — the data-seq jump/scroll machinery targets
  out: boolean
  firstInGroup: boolean
  lastInGroup: boolean
  selecting: boolean
  isSelected: boolean
  isHighlighted: boolean
  ladderActive: boolean
  ladderDelay: number
  feedFns: FeedFns
  // Автозагрузка медиа для этого чата (tweb chat.autoDownload); 0 = по клику.
  autoDownload?: ChatAutoDownload
  // csv id выбранных элементов альбома (стабильная строка — memo не ломается
  // у остальных рядов; только для m.type === 'album')
  albumSelectedKey?: string
  // Optional slot rendered at the bottom of the bubble (channel post replies-footer).
  footer?: ReactNode
}

function MessageRow({
  m, seq, out, firstInGroup, lastInGroup,
  selecting, isSelected, isHighlighted, ladderActive, ladderDelay,
  feedFns, autoDownload, albumSelectedKey, footer,
}: MessageRowProps) {
  const { textSize } = useSettings()
  const t = useT()
  const fmtTime = useTimeFormatter()
  const bigEmoji = m.type === 'text' && m.text ? emojiOnlyCount(m.text) : 0
  // Block-level content (code block / quote) takes the full bubble width, so the
  // time drops onto its own line below it (right-aligned) instead of floating
  // awkwardly to the right of the block.
  const hasBlock = m.entities?.some((e) => e.type === 'pre' || e.type === 'blockquote') ?? false
  const rowStyle = { '--msg-text-size': `${textSize}px` } as CSSProperties

  // Реакции: внутри бабла у text/poll/media/album; у остальных типов (voice,
  // sticker, document, …) — плавающей строкой под баблом (tweb reactions-out).
  // rowLive: реакции появились у УЖЕ смонтированного ряда → анимируем вход.
  const rowLiveRef = useRef(false)
  useEffect(() => { rowLiveRef.current = true }, [])
  const chips =
    m.reactions?.length && m.id != null && !selecting ? (
      <MessageReactions reactions={m.reactions} rowLive={rowLiveRef.current} onToggle={(emoji) => feedFns.toggleReaction(m.id!, emoji)} onShow={(x, y) => feedFns.showReactedUsers(m.id!, x, y)} />
    ) : null
  const chipsInline =
    ((m.type === 'text' && !bigEmoji) || m.type === 'poll' || m.type === 'album'
      || ((m.mediaId != null || !!m.localUrl) && m.type !== 'roundVideo' && m.type !== 'voice' && m.type !== 'sticker'))

  return (
    <BubbleAppear
      appear={ladderActive}
      delay={ladderDelay}
      className={s.row}
      data-out={out || undefined}
      data-last={lastInGroup || undefined}
      data-selecting={selecting || undefined}
      data-mid={m.id}
      data-seq={seq}
      onContextMenu={selecting ? undefined : (e: MouseEvent) => feedFns.openMsgMenu(e, m)}
      // Обычный клик по error-баблу открывает то же меню (Переотправить/Удалить).
      onClick={
        selecting && m.id != null && m.type !== 'album' // альбом тогглится по-элементно
          ? () => feedFns.toggleSelect(m.id!)
          : m.status === 'error'
            ? (e: MouseEvent) => feedFns.openMsgMenu(e, m)
            : undefined
      }
      style={rowStyle}
    >
      {/* Jump-to-message flash (fades in then out). */}
      {isHighlighted && (
        <motion.div
          className={s.band}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.5, 0.5, 0] }}
          transition={{ duration: 2, times: [0, 0.12, 0.5, 1] }}
        />
      )}
      {/* Full-width selection band (tweb: rgba(primary,.3), fades in). */}
      {selecting && m.id != null && isSelected && (
        <motion.div
          className={s.band}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        />
      )}
      {selecting && m.id != null && m.type !== 'album' && (
        <div className={s.check}>
          <Checkbox checked={isSelected} />
        </div>
      )}

      <div className={s.zone}>
        <ZoneBody chipsOutside={chipsInline ? null : chips}>
        {m.mediaId && m.type === 'roundVideo' ? (
          <RoundVideoRealBubble
            m={m}
            onPlayed={m.id != null ? () => feedFns.mediaPlayed(m.id as number) : undefined}
            onSoundPlay={m.id != null ? (el) => feedFns.roundPlaying(m.id as number, el) : undefined}
          />
        ) : m.mediaId && m.type === 'voice' ? (
          <div className={s.voiceMedia} style={{ borderRadius: mediaRadius(out, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <VoiceMessage
              mediaId={m.mediaId}
              out={out}
              time={m.time}
              status={m.status}
              mediaUnread={m.mediaUnread}
              tickColor="var(--b-tick)"
              onPlay={() => feedFns.playVoice(m.mediaId as number)}
            />
          </div>
        ) : m.type === 'album' && m.albumItems ? (
          // Альбом (медиагруппа): грид из элементов, подпись — под гридом.
          <div className={s.media}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <div
              className={classNames(s.mediaInner, s.framed)}
              style={{ borderRadius: mediaRadius(out, lastInGroup) }}
            >
              <AlbumGrid
                items={m.albumItems}
                selecting={selecting}
                selectedKey={albumSelectedKey}
                time={m.text ? undefined : m.time}
                status={m.status}
                out={out}
                onToggle={feedFns.toggleSelect}
                onOpen={feedFns.openLightbox}
                autoDownload={autoDownload}
                radius={m.text || chips ? '14px 14px 0 0' : '14px'}
              />
              {m.text ? (
                <div className={s.mediaCaption}>
                  <span className={s.mediaText}>
                    <RichText text={m.text} entities={m.entities} linkColor="var(--b-link)" />
                  </span>
                  {m.time && (
                    <span className={s.mediaTime}>
                      <span className={s.mediaTimeText} style={{ color: out ? 'var(--tg-bubbleOutAccent)' : 'var(--tg-textFaint)' }}>
                        {m.time}
                      </span>
                      {out && <Ticks status={m.status} color="var(--b-tick)" />}
                    </span>
                  )}
                </div>
              ) : null}
              {chips && <div className={s.reactionsPad}>{chips}</div>}
            </div>
          </div>
        ) : m.type === 'sticker' && m.mediaId != null ? (
          // Стикер (tweb .bubble.is-sticker + wrappers/sticker.ts): без фона
          // бабла и хвостика; бокс аспект-фитится в 200×200 (mediaSizes
          // staticSticker/animatedSticker desktop), lottie играет с loop из
          // настроек; время+тики бейджем поверх нижнего угла, реакции — снаружи
          // (reactions-out), reply/имя в группе не рисуются (как voice/round).
          <StickerRealBubble m={m} fmtTime={fmtTime} />
        ) : m.mediaId != null || m.localUrl || (m.clientId != null && m.mediaName != null) ? (
          // Outer (relative, NOT clipped) carries the tail; the inner clips the media
          // to the rounded corners. The tailed corner is squared off (like other bubbles).
          // localUrl без mediaId = исходящее фото/видео в процессе аплоада;
          // clientId+mediaName без mediaId = исходящий документ/аудио в процессе
          // аплоада (кольцо прогресса + отмена рисует RealMediaBubble).
          <div className={s.media}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <div
              className={classNames(s.mediaInner, m.type === 'photo' || m.type === 'video' ? s.framed : '')}
              style={{ borderRadius: mediaRadius(out, lastInGroup) }}
            >
              {m.secretMedia ? (
                // Секретное медиа (E2E): fetch ciphertext → decrypt → blob-objectURL.
                // Прямой src=mediaContentUrl не годится — сервер хранит только шифртекст.
                <SecretMediaBubble
                  secretMedia={m.secretMedia}
                  out={out}
                  time={m.text ? undefined : m.time}
                  status={m.status}
                  tickColor="var(--b-tick)"
                  localUrl={m.localUrl}
                  radius={(m.type === 'photo' || m.type === 'video') ? (m.text || chips ? '14px 14px 0 0' : '14px') : undefined}
                />
              ) : (
                <RealMediaBubble
                  mediaId={m.mediaId}
                  type={m.type}
                  width={m.mediaWidth}
                  height={m.mediaHeight}
                  mime={m.mediaMime}
                  blur={m.mediaBlur}
                  hasThumb={m.mediaHasThumb}
                  duration={m.mediaDuration}
                  size={m.mediaSize}
                  fileName={m.mediaName}
                  out={out}
                  time={m.text ? undefined : m.time}
                  status={m.status}
                  tickColor="var(--b-tick)"
                  onOpen={feedFns.openLightbox}
                  autoDownload={autoDownload}
                  localUrl={m.localUrl}
                  clientId={m.clientId}
                  onCancelUpload={feedFns.cancelUpload}
                  radius={(m.type === 'photo' || m.type === 'video') ? (m.text || chips ? '14px 14px 0 0' : '14px') : undefined}
                />
              )}
              {m.text ? (
                <div className={s.mediaCaption}>
                  <span className={s.mediaText}>
                    <RichText text={m.text} entities={m.entities} linkColor="var(--b-link)" />
                  </span>
                  {m.time && (
                    <span className={s.mediaTime}>
                      {m.effect && <EffectReplayButton kind={m.effect} />}
                      {/* truthy как в tweb (messageRender.ts): views=0 приходит для не-канальных сообщений */}
                      {m.views ? <ViewsMeta views={m.views} className={s.metaViews} /> : null}
                      {m.forwards ? <ForwardsMeta forwards={m.forwards} className={s.metaViews} /> : null}
                      <span className={s.mediaTimeText} style={{ color: out ? 'var(--tg-bubbleOutAccent)' : 'var(--tg-textFaint)' }}>
                        {m.time}
                      </span>
                      {out && <Ticks status={m.status} color="var(--b-tick)" />}
                    </span>
                  )}
                </div>
              ) : null}
              {chips && <div className={s.reactionsPad}>{chips}</div>}
              {footer && <div className={s.footerMedia}>{footer}</div>}
            </div>
          </div>
        ) : bigEmoji ? (
          <BigEmojiBubble m={m} count={bigEmoji} selecting={selecting} fmtTime={fmtTime} />
        ) : m.type === 'voice' ? (
          <div className={s.voice} style={{ borderRadius: mediaRadius(out, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <div className={s.voiceBtn}>
              <TgIcon name="play" />
            </div>
            <div className={s.voiceBody}>
              <div className={s.wave}>
                {(m.waveform ?? []).map((h, wi) => (
                  <div key={wi} className={s.waveBar} style={{ height: `${Math.round(6 + h * 16)}px` }} />
                ))}
              </div>
              <div className={s.voiceMeta}>
                <Text size={12.5} color="var(--b-secondary)">{m.duration}</Text>
                <div className={s.spacer} />
                <Text size={12} color="var(--b-time)">{fmtTime(m.time)}</Text>
                <Ticks status={m.status} color="var(--b-tick)" />
              </div>
            </div>
          </div>
        ) : m.type === 'document' ? (
          <DocumentBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />
        ) : m.type === 'audio' ? (
          <AudioBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />
        ) : m.type === 'roundVideo' ? (
          <RoundVideoBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />
        ) : m.type === 'geo' && m.geo ? (
          <GeoBubble m={m} out={out} lastInGroup={lastInGroup} radius={mediaRadius(out, lastInGroup)} />
        ) : m.type === 'contact' && m.contact ? (
          <ContactBubble
            m={m}
            out={out}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            onOpen={selecting ? undefined : () => feedFns.openSender(m.contact!.userId, m.contact!.name)}
          />
        ) : m.type === 'call' ? (
          <CallBubble
            m={m}
            out={out}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            onClick={selecting ? undefined : () => feedFns.recall(!!m.call?.video)}
          />
        ) : m.type === 'gift' && m.gift ? (
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <GiftBubble gift={m.gift} out={out} />
          </div>
        ) : m.type === 'giveaway' && m.giveaway ? (
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <GiveawayBubble giveaway={m.giveaway} />
          </div>
        ) : m.type === 'poll' && m.poll ? (
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            {!out && m.sender && firstInGroup && (
              <Text size={14} weight={600} color={m.senderColor ?? peerColor(m.sender)}>
                {m.sender}
              </Text>
            )}
            <PollBubble poll={m.poll} out={out} />
            <div className={s.textLine} style={{ justifyContent: 'flex-end' }}>
              <span className={s.meta}>
                <span className={s.metaTime}>{fmtTime(m.time)}</span>
                <Ticks status={m.status} color="var(--b-tick)" />
              </span>
            </div>
            {chips}
          </div>
        ) : (
          // tweb .bubble-content-wrapper: цветной бабл + reply-markup сиблингами;
          // кнопки лежат ВНЕ бабла (под ним), бабл растягивается на их ширину.
          <div className={s.bubbleWrap}>
          <div className={s.textBubble} style={{ borderRadius: bubbleRadius(out, firstInGroup, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            {!out && m.sender && firstInGroup && (
              <Text
                onClick={m.senderId != null ? () => feedFns.openSender(m.senderId!, m.sender!) : undefined}
                size={14} weight={600} color={m.senderColor ?? peerColor(m.sender)}
                style={{ cursor: m.senderId != null ? 'pointer' : 'default' }}
              >
                {m.sender}
              </Text>
            )}
            {m.forwardFrom && (
              <div className={s.forward}>
                <Text size={13} color="var(--b-time)">{t('Forwarded from')}</Text>
                <Text size={14} weight={600} color={out ? 'var(--tg-bubbleOutAccent)' : (m.forwardFrom.color ?? 'var(--tg-accent)')}>
                  {m.forwardFrom.name}
                </Text>
              </div>
            )}
            {m.reply && (
              <div
                className={s.reply}
                onClick={m.reply.seq != null ? (e) => { e.stopPropagation(); feedFns.jumpToSeq(m.reply!.seq) } : undefined}
                style={{
                  cursor: m.reply.seq != null ? 'pointer' : 'default',
                  borderLeft: `3px solid ${out ? 'var(--tg-bubbleOutAccent)' : m.reply.color ?? 'var(--tg-accent)'}`,
                  background: out ? withAlpha('var(--tg-bubbleOutText)', 0.12) : withAlpha(m.reply.color ?? 'var(--tg-accent)', 0.12),
                }}
              >
                {m.reply.mediaId != null && <ReplyThumb id={m.reply.mediaId} />}
                <div className={s.replyBody}>
                  <Text noWrap size={13.5} weight={600} color={out ? 'var(--tg-bubbleOutAccent)' : m.reply.color ?? 'var(--tg-accent)'}>
                    {m.reply.name}
                    {m.reply.quote && (
                      <TgIcon name="quote_outline" size={13} style={{ verticalAlign: '-1px', marginLeft: 4, opacity: 0.75 }} />
                    )}
                  </Text>
                  <Text noWrap size={13.5} color="var(--b-secondary)" style={{ maxWidth: 240 }}>
                    <RichText text={m.reply.text} entities={m.reply.entities} linkColor="var(--b-link)" />
                  </Text>
                </div>
              </div>
            )}
            <div className={s.textLine}>
              <span className={classNames(s.msgText, hasBlock ? s.block : '')}>
                <RichText text={m.text ?? ''} entities={m.entities} linkColor="var(--b-link)" />
              </span>
              <span className={classNames(s.meta, hasBlock ? s.block : '')}>
                {m.effect && <EffectReplayButton kind={m.effect} />}
                {m.views ? <ViewsMeta views={m.views} className={s.metaViews} /> : null}
                {m.forwards ? <ForwardsMeta forwards={m.forwards} className={s.metaViews} /> : null}
                {m.secret && <SecretTimer destructAt={m.destructAt} ttlSeconds={m.ttlSeconds} color="var(--b-time)" />}
                <span className={s.metaTime}>{m.edited ? `${t('edited')} ` : ''}{fmtTime(m.time)}</span>
                <Ticks status={m.status} color="var(--b-tick)" />
              </span>
            </div>
            {m.webPage && (
              <WebPagePreview wp={m.webPage} out={out} linkColor="var(--b-link)" />
            )}
            {chips}
            {footer && <div className={s.footerText}>{footer}</div>}
          </div>
          {m.replyMarkup?.inline && m.chatId != null && m.senderId != null && (
            <InlineKeyboard rows={m.replyMarkup.inline} chatId={m.chatId} botId={m.senderId} msgId={m.id} />
          )}
          </div>
        )}
        </ZoneBody>
      </div>
    </BubbleAppear>
  )
}

// Big emoji (tweb bubbles.ts bigEmojis): сообщение из 1–3 эмодзи без текста —
// крупный глиф без фона бабла. РОВНО один эмодзи, у которого есть лотти в
// сид-наборе animated_emoji, рендерится анимированным стикером (tweb
// getAnimatedEmojiSticker → wrapSticker): autoplay ОДИН раз (не loop), replay по
// клику. Клик по эффект-эмодзи (❤️/🎉/👍/…) — и по анимированному, и по
// шрифтовому — запускает полноэкранный canvas-эффект из центра бабла.
const ANIMATED_EMOJI_SIZE = 160
function BigEmojiBubble({ m, count, selecting, fmtTime }: {
  m: ConvMsg
  count: number
  selecting: boolean
  fmtTime: (hhmm?: string) => string | undefined
}) {
  const emoji = count === 1 ? (m.text ?? '').trim() : null
  const animated = useAnimatedEmoji(emoji)
  const [replayToken, setReplayToken] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const effect = emoji ? effectForEmoji(emoji) : null
  // В selecting клик занят выбором, у error-бабла — меню переотправки.
  const clickable = !selecting && m.status !== 'error' && (effect != null || animated != null)
  const onClick = clickable
    ? () => {
        if (effect) {
          const r = boxRef.current?.getBoundingClientRect()
          playEmojiEffect(effect, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined)
        }
        if (animated) setReplayToken((t) => t + 1)
      }
    : undefined
  return (
    <div ref={boxRef} className={s.sticker} onClick={onClick} style={clickable ? { cursor: 'pointer' } : undefined}>
      {animated ? (
        <StickerMedia mediaId={animated.mediaId} width={ANIMATED_EMOJI_SIZE} height={ANIMATED_EMOJI_SIZE} autoplay replayToken={replayToken} />
      ) : (
        <div
          className={s.stickerGlyph}
          style={{
            fontSize: count === 1 ? 56 : count === 2 ? 46 : 38,
            padding: '2px 0',
          }}
        >
          {m.text}
        </div>
      )}
      <div className={s.stickerMeta}>
        <Text size={12.5} color="#fff">{fmtTime(m.time)}</Text>
        <Ticks status={m.status} color="var(--b-tick)" />
      </div>
    </div>
  )
}

// Стикер с бэка (m.type 'sticker' + mediaId): бокс аспект-фитится в 200×200
// (tweb mediaSizes desktop static/animatedSticker), lottie-json играет через
// lottie-web c loop из настройки «Зацикливать анимации», webp/png — <img>
// (различает StickerMedia). Бейдж времени — тот же, что у big-emoji.
const STICKER_BOX = 200
function StickerRealBubble({ m, fmtTime }: { m: ConvMsg; fmtTime: (hhmm?: string) => string | undefined }) {
  const loopStickers = useSettings().loopStickers
  let w = STICKER_BOX
  let h = STICKER_BOX
  if (m.mediaWidth && m.mediaHeight) {
    const k = Math.min(STICKER_BOX / m.mediaWidth, STICKER_BOX / m.mediaHeight)
    w = Math.round(m.mediaWidth * k)
    h = Math.round(m.mediaHeight * k)
  }
  return (
    <div className={s.stickerReal}>
      <StickerMedia mediaId={m.mediaId!} width={w} height={h} autoplay loop={loopStickers} />
      <div className={s.stickerMeta}>
        <Text size={12.5} color="#fff">{fmtTime(m.time)}</Text>
        <Ticks status={m.status} color="var(--b-tick)" />
      </div>
    </div>
  )
}

// Small rounded thumbnail of the replied-to message's photo/video, shown in the
// quote box (Telegram). Synchronous URL via the main-thread media token.
function ReplyThumb({ id }: { id: number }) {
  useMediaTokenVersion()
  if (!hasMediaToken()) return null
  return <img className={s.replyThumb} src={mediaThumbUrl(id)} alt="" />
}

export default memo(MessageRow)
