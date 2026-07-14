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
import { memo, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import { withAlpha } from '../../core/cssColor'
import { mediaThumbUrl, hasMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import TgIcon from '../TgIcon'
import { BubbleAppear } from '../animations/bubbleAnimations'
import RealMediaBubble from './RealMediaBubble'
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
} from './MessageBubbles'
import RichText, { emojiOnlyCount } from '../RichText'
import Emoji from '../emoji/Emoji'
import { peerColor } from '../peerColor'
import { fmtViews } from '../../core/fmtViews'
import { useT } from '../../i18n'
import { useSettings, useTimeFormatter } from '../../settings'
import type { ConvMsg } from '../../data'
import s from './MessageRow.module.scss'

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
  // Optional slot rendered at the bottom of the bubble (channel post replies-footer).
  footer?: ReactNode
}

function MessageRow({
  m, seq, out, firstInGroup, lastInGroup,
  selecting, isSelected, isHighlighted, ladderActive, ladderDelay,
  feedFns, footer,
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
        selecting && m.id != null
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
      {selecting && m.id != null && (
        <div className={s.check}>
          <Checkbox checked={isSelected} />
        </div>
      )}

      <div className={s.zone}>
        {m.mediaId && m.type === 'roundVideo' ? (
          <RoundVideoRealBubble m={m} />
        ) : m.mediaId && m.type === 'voice' ? (
          <div className={s.voiceMedia} style={{ borderRadius: mediaRadius(out, lastInGroup) }}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <VoiceMessage
              mediaId={m.mediaId}
              out={out}
              time={m.time}
              status={m.status}
              msgId={m.id}
              tickColor="var(--b-tick)"
              onPlay={() => feedFns.playVoice(m.mediaId as number)}
            />
          </div>
        ) : m.mediaId ? (
          // Outer (relative, NOT clipped) carries the tail; the inner clips the media
          // to the rounded corners. The tailed corner is squared off (like other bubbles).
          <div className={s.media}>
            {lastInGroup && <BubbleTail out={out} color="var(--b-bg)" />}
            <div
              className={classNames(s.mediaInner, m.type === 'photo' || m.type === 'video' ? s.framed : '')}
              style={{ borderRadius: mediaRadius(out, lastInGroup) }}
            >
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
                radius={(m.type === 'photo' || m.type === 'video') ? (m.text ? '14px 14px 0 0' : '14px') : undefined}
              />
              {m.text ? (
                <div className={s.mediaCaption}>
                  <span className={s.mediaText}>
                    <RichText text={m.text} entities={m.entities} linkColor="var(--b-link)" />
                  </span>
                  {m.time && (
                    <span className={s.mediaTime}>
                      {/* truthy как в tweb (messageRender.ts): views=0 приходит для не-канальных сообщений */}
                      {m.views ? <ViewsMeta views={m.views} className={s.metaViews} /> : null}
                      <span className={s.mediaTimeText} style={{ color: out ? 'var(--tg-bubbleOutAccent)' : 'var(--tg-textFaint)' }}>
                        {m.time}
                      </span>
                      {out && <Ticks status={m.status} color="var(--b-tick)" />}
                    </span>
                  )}
                </div>
              ) : null}
              {footer && <div className={s.footerMedia}>{footer}</div>}
            </div>
          </div>
        ) : m.type === 'sticker' || bigEmoji ? (
          <div className={s.sticker}>
            <div
              className={s.stickerGlyph}
              style={{
                fontSize: bigEmoji ? (bigEmoji === 1 ? 56 : bigEmoji === 2 ? 46 : 38) : 64,
                padding: bigEmoji ? '2px 0' : 0,
              }}
            >
              {m.type === 'sticker' ? <Emoji e={m.emoji ?? ''} size={104} /> : m.text}
            </div>
            <div className={s.stickerMeta}>
              <Text size={12.5} color="#fff">{fmtTime(m.time)}</Text>
              <Ticks status={m.status} color="var(--b-tick)" />
            </div>
          </div>
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
        ) : m.type === 'call' ? (
          <CallBubble
            m={m}
            out={out}
            firstInGroup={firstInGroup}
            lastInGroup={lastInGroup}
            onClick={selecting ? undefined : () => feedFns.recall(!!m.call?.video)}
          />
        ) : (
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
                {m.views ? <ViewsMeta views={m.views} className={s.metaViews} /> : null}
                <span className={s.metaTime}>{m.edited ? `${t('edited')} ` : ''}{fmtTime(m.time)}</span>
                <Ticks status={m.status} color="var(--b-tick)" />
              </span>
            </div>
            {m.webPage && (
              <WebPagePreview wp={m.webPage} out={out} linkColor="var(--b-link)" />
            )}
            {footer && <div className={s.footerText}>{footer}</div>}
          </div>
        )}
      </div>
    </BubbleAppear>
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
