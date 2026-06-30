// src/components/messages/MessageRow.tsx
// ONE message bubble, memoized. Extracted from ConversationView's feed so that
// appending/sending a message re-renders only the new (and the previous-last,
// whose group tail flips) row — not all ~40 bubbles. memo() bails when its props
// are unchanged; this works because `m` (ConvMsg) is given a STABLE reference by
// the parent's conversion cache, and every other prop is a primitive or a stable
// callback object (feedFns). The media viewer is opened via context (useMediaViewer).
import { memo, type MouseEvent } from 'react'
import { Box, Typography, useTheme } from '@mui/material'
import Text from '../../shared/ui/Text'
import { withAlpha } from '../../core/cssColor'
import { mediaThumbUrl, hasMediaToken, useMediaTokenVersion } from '../../core/mediaUrl'
import { motion } from 'framer-motion'
import TgIcon from '../TgIcon'
import { BubbleAppear } from '../animations/bubbleAnimations'
import RealMediaBubble from './RealMediaBubble'
import VoiceMessage from './VoiceMessage'
import SelectCheckbox from './SelectCheckbox'
import {
  Ticks,
  BubbleTail,
  DocumentBubble,
  AudioBubble,
  RoundVideoBubble,
  WebPagePreview,
} from './MessageBubbles'
import RichText, { emojiOnlyCount } from '../RichText'
import Emoji from '../emoji/Emoji'
import { peerColor } from '../peerColor'
import { useT } from '../../i18n'
import { useSettings, useTimeFormatter } from '../../settings'
import type { ConvMsg } from '../../data'

// Stable handler bundle the feed/rows close over (identities never change — see
// ConversationView's useEvent wrappers), so passing it through doesn't bust memo.
export interface FeedFns {
  openSender: (senderId: number, fallbackName: string) => void
  playVoice: (mediaId: number) => void
  toggleSelect: (id: number) => void
  openMsgMenu: (e: MouseEvent, m: ConvMsg) => void
  jumpToSeq: (seq?: number) => void
  openLightbox: (mediaId: number, el: HTMLElement) => void
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
}

function MessageRow({
  m, seq, out, firstInGroup, lastInGroup,
  selecting, isSelected, isHighlighted, ladderActive, ladderDelay,
  feedFns,
}: MessageRowProps) {
  const tg = useTheme().tg
  const incomingBg = tg.bubble
  const { textSize } = useSettings()
  const t = useT()
  const fmtTime = useTimeFormatter()
  const tickColor = tg.bubbleOutAccent
  const bigEmoji = m.type === 'text' && m.text ? emojiOnlyCount(m.text) : 0
  // Block-level content (code block / quote) takes the full bubble width, so the
  // time drops onto its own line below it (right-aligned) instead of floating
  // awkwardly to the right of the block.
  const hasBlock = m.entities?.some((e) => e.type === 'pre' || e.type === 'blockquote') ?? false

  return (
    <BubbleAppear
      appear={ladderActive}
      delay={ladderDelay}
      data-mid={m.id}
      data-seq={seq}
      onContextMenu={selecting ? undefined : (e: MouseEvent) => feedFns.openMsgMenu(e, m)}
      onClick={selecting && m.id != null ? () => feedFns.toggleSelect(m.id!) : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        cursor: selecting ? 'pointer' : 'default',
        marginBottom: lastInGroup ? 6 : 2,
        transformOrigin: out ? 'bottom right' : 'bottom left',
      }}
    >
      {/* Jump-to-message flash (fades in then out). */}
      {isHighlighted && (
        <Box
          component={motion.div}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.5, 0.5, 0] }}
          transition={{ duration: 2, times: [0, 0.12, 0.5, 1] }}
          sx={{
            position: 'absolute', top: 0, bottom: `${-(lastInGroup ? 6 : 2)}px`,
            left: '50%', transform: 'translateX(-50%)', width: '100vw',
            background: withAlpha(tg.accent, 0.3), zIndex: 0, pointerEvents: 'none',
          }}
        />
      )}
      {/* Full-width selection band (tweb: rgba(primary,.3), fades in). */}
      {selecting && m.id != null && isSelected && (
        <Box
          component={motion.div}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          sx={{
            position: 'absolute',
            top: 0,
            bottom: `${-(lastInGroup ? 6 : 2)}px`,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '100vw',
            background: withAlpha(tg.accent, 0.3),
            zIndex: 0,
            pointerEvents: 'none',
          }}
        />
      )}
      {selecting && m.id != null && (
        <Box sx={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', zIndex: 2 }}>
          <SelectCheckbox checked={isSelected} accent={tg.accent} ring={tg.textFaint} />
        </Box>
      )}
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          minWidth: 0,
          display: 'flex',
          justifyContent: out ? 'flex-end' : 'flex-start',
          transform: selecting && !out ? 'translateX(34px)' : 'none',
          transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
      {m.mediaId && m.type === 'voice' ? (
        <Box
          sx={{
            position: 'relative',
            maxWidth: 'min(340px, 82%)',
            background: out ? tg.bubbleOut : incomingBg,
            color: out ? tg.bubbleOutText : tg.textPrimary,
            borderRadius: out
              ? `15px 15px ${lastInGroup ? 0 : 5}px 15px`
              : `15px 15px 15px ${lastInGroup ? 0 : 5}px`,
          }}
        >
          {lastInGroup && <BubbleTail out={out} color={out ? tg.bubbleOut : incomingBg} />}
          <VoiceMessage
            mediaId={m.mediaId}
            out={out}
            time={m.time}
            status={m.status}
            msgId={m.id}
            tickColor={tickColor}
            onPlay={() => feedFns.playVoice(m.mediaId as number)}
          />
        </Box>
      ) : m.mediaId ? (
        // Outer box (relative, NOT clipped) carries the tail; the inner
        // box clips the media to the rounded corners. The tailed corner
        // is squared off so the tail attaches cleanly (like other bubbles).
        <Box sx={{ position: 'relative', maxWidth: 'min(340px, 82%)' }}>
          {lastInGroup && <BubbleTail out={out} color={out ? tg.bubbleOut : incomingBg} />}
          <Box
            sx={{
              position: 'relative',
              background: out ? tg.bubbleOut : incomingBg,
              color: out ? tg.bubbleOutText : tg.textPrimary,
              overflow: 'hidden',
              // photo/video sit inside the bubble with a 1px bubble-coloured
              // frame (Telegram "обводка"); file/audio rows fill flush.
              p: (m.type === 'photo' || m.type === 'video') ? '1px' : 0,
              borderRadius: out
                ? `15px 15px ${lastInGroup ? 0 : 5}px 15px`
                : `15px 15px 15px ${lastInGroup ? 0 : 5}px`,
            }}
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
              tickColor={tickColor}
              onOpen={feedFns.openLightbox}
              radius={(m.type === 'photo' || m.type === 'video') ? (m.text ? '14px 14px 0 0' : '14px') : undefined}
            />
            {m.text ? (
              <Box sx={{ px: 1.25, pb: 0.5 }}>
                <Typography component="span" sx={{ fontSize: textSize, color: out ? tg.bubbleOutText : tg.textPrimary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}><RichText text={m.text} entities={m.entities} linkColor={out ? tg.bubbleOutAccent : tg.link} /></Typography>
                {m.time && (
                  <Box component="span" sx={{ float: 'right', display: 'inline-flex', alignItems: 'center', gap: 0.25, ml: 1, mt: 0.5 }}>
                    <Typography component="span" sx={{ fontSize: 12, color: out ? tickColor : tg.textFaint, fontVariantNumeric: 'tabular-nums' }}>{m.time}</Typography>
                    {out && (m.status === 'read' ? <TgIcon name="checks" size={16} color={tickColor} /> : <TgIcon name="check" size={16} color={tickColor} />)}
                  </Box>
                )}
              </Box>
            ) : null}
          </Box>
        </Box>
      ) : m.type === 'sticker' || bigEmoji ? (
        <Box sx={{ position: 'relative', display: 'inline-block', px: 0.5 }}>
          <Box
            sx={{
              fontSize: bigEmoji ? (bigEmoji === 1 ? 56 : bigEmoji === 2 ? 46 : 38) : 64,
              lineHeight: 1.1,
              userSelect: 'none',
              py: bigEmoji ? 0.25 : 0,
            }}
          >
            {m.type === 'sticker' ? <Emoji e={m.emoji ?? ''} size={104} /> : m.text}
          </Box>
          <Box
            sx={{
              position: 'absolute',
              right: 6,
              bottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 0.25,
              px: 0.75,
              py: 0.2,
              borderRadius: '11px',
              background: 'rgba(0,0,0,0.45)',
            }}
          >
            <Text size={12.5} color="#fff">{fmtTime(m.time)}</Text>
            <Ticks status={m.status} color={tickColor} />
          </Box>
        </Box>
      ) : m.type === 'voice' ? (
        <Box
          sx={{
            position: 'relative',
            maxWidth: 'min(320px, 82%)',
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            px: 1.25,
            py: 1,
            background: out ? tg.bubbleOut : incomingBg,
            color: out ? tg.bubbleOutText : tg.textPrimary,
            borderRadius: out
              ? `15px 15px ${lastInGroup ? 0 : 5}px 15px`
              : `15px 15px 15px ${lastInGroup ? 0 : 5}px`,
          }}
        >
          {lastInGroup && <BubbleTail out={out} color={out ? tg.bubbleOut : incomingBg} />}
          <Box
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: out ? tg.bubbleOutAccent : tg.accent,
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            <TgIcon name="play" />
          </Box>
          <Box sx={{ minWidth: 150 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px', height: 22 }}>
              {(m.waveform ?? []).map((h, wi) => (
                <Box
                  key={wi}
                  sx={{
                    width: '2.5px',
                    flexShrink: 0,
                    borderRadius: '2px',
                    height: `${Math.round(6 + h * 16)}px`,
                    background: out ? tg.bubbleOutAccent : tg.textFaint,
                  }}
                />
              ))}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              <Text size={12.5} color={out ? withAlpha(tg.bubbleOutText, 0.85) : tg.textSecondary}>
                {m.duration}
              </Text>
              <Box sx={{ flex: 1 }} />
              <Text size={12} color={out ? withAlpha(tg.bubbleOutText, 0.7) : tg.textFaint}>
                {fmtTime(m.time)}
              </Text>
              <Ticks status={m.status} color={tickColor} />
            </Box>
          </Box>
        </Box>
      ) : m.type === 'document' ? (
        <DocumentBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />
      ) : m.type === 'audio' ? (
        <AudioBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />
      ) : m.type === 'roundVideo' ? (
        <RoundVideoBubble m={m} out={out} firstInGroup={firstInGroup} lastInGroup={lastInGroup} />
      ) : (
        <Box
          sx={{
            position: 'relative',
            maxWidth: 'min(420px, 80%)',
            display: 'flex',
            flexDirection: 'column',
            px: 1.25,
            py: 0.65,
            background: out ? tg.bubbleOut : incomingBg,
            color: out ? tg.bubbleOutText : tg.textPrimary,
            borderRadius: out
              ? `15px ${firstInGroup ? 15 : 5}px ${lastInGroup ? 0 : 5}px 15px`
              : `${firstInGroup ? 15 : 5}px 15px 15px ${lastInGroup ? 0 : 5}px`,
          }}
        >
          {lastInGroup && <BubbleTail out={out} color={out ? tg.bubbleOut : incomingBg} />}
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
            <Box sx={{ mb: 0.25 }}>
              <Text size={13} color={out ? withAlpha(tg.bubbleOutText, 0.7) : tg.textFaint}>
                {t('Forwarded from')}
              </Text>
              <Text size={14} weight={600} color={out ? tg.bubbleOutAccent : (m.forwardFrom.color ?? tg.accent)}>
                {m.forwardFrom.name}
              </Text>
            </Box>
          )}
          {m.reply && (
            <Box
              onClick={m.reply.seq != null ? (e) => { e.stopPropagation(); feedFns.jumpToSeq(m.reply!.seq) } : undefined}
              sx={{
                mb: 0.5,
                px: 1,
                py: 0.5,
                borderRadius: '6px',
                cursor: m.reply.seq != null ? 'pointer' : 'default',
                borderLeft: `3px solid ${out ? tg.bubbleOutAccent : m.reply.color ?? tg.accent}`,
                background: out ? withAlpha(tg.bubbleOutText, 0.12) : withAlpha(m.reply.color ?? tg.accent, 0.12),
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
              }}
            >
              {m.reply.mediaId != null && <ReplyThumb id={m.reply.mediaId} />}
              <Box sx={{ minWidth: 0 }}>
                <Text noWrap size={13.5} weight={600} color={out ? tg.bubbleOutAccent : m.reply.color ?? tg.accent}>
                  {m.reply.name}
                </Text>
                <Text noWrap size={13.5} color={out ? withAlpha(tg.bubbleOutText, 0.85) : tg.textSecondary} style={{ maxWidth: 240 }}>
                  <RichText text={m.reply.text} entities={m.reply.entities} linkColor={out ? tg.bubbleOutAccent : tg.link} />
                </Text>
              </Box>
            </Box>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 0.75 }}>
            <Typography component="span" sx={{ fontSize: textSize, lineHeight: 1.35, whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...(hasBlock && { width: '100%' }) }}>
              <RichText text={m.text ?? ''} entities={m.entities} linkColor={out ? tg.bubbleOutAccent : tg.link} />
            </Typography>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.25,
                ml: 'auto',
                transform: 'translateY(2px)',
                ...(hasBlock && { width: '100%', justifyContent: 'flex-end' }),
              }}
            >
              <Typography
                component="span"
                sx={{
                  fontSize: 12,
                  color: out ? withAlpha(tg.bubbleOutText, 0.7) : tg.textFaint,
                  whiteSpace: 'nowrap',
                }}
              >
                {m.edited ? `${t('edited')} ` : ''}{fmtTime(m.time)}
              </Typography>
              <Ticks status={m.status} color={tickColor} />
            </Box>
          </Box>
          {m.webPage && (
            <WebPagePreview wp={m.webPage} out={out} linkColor={out ? tg.bubbleOutAccent : tg.link} />
          )}
        </Box>
      )}
      </Box>
    </BubbleAppear>
  )
}

// Small rounded thumbnail of the replied-to message's photo/video, shown in the
// quote box (Telegram). Synchronous URL via the main-thread media token.
function ReplyThumb({ id }: { id: number }) {
  useMediaTokenVersion()
  if (!hasMediaToken()) return null
  return (
    <Box
      component="img"
      src={mediaThumbUrl(id)}
      alt=""
      sx={{ width: 34, height: 34, borderRadius: '4px', objectFit: 'cover', flexShrink: 0, display: 'block' }}
    />
  )
}

export default memo(MessageRow)
