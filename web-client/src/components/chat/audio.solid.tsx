/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/audio.tsx` (812502980, 326 строк) — плашка аудиоплеера над
// колонкой чата: назад/играть/вперёд, название и время, громкость, скорость, повтор, закрыть.
// Монтирует её `appImManager.construct` (tweb `appImManager.ts:854-855`). Пачка П-5 волны 7
// (Б-22); заменяет снесённый на К-3 React `NowPlayingBar.tsx`.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Контроллер — наш `core/audio/mediaPlaybackController.ts` (порт
//     `appMediaPlaybackController` в объёме голоса и музыки) с витриной `useAudioStore`:
//     события `play`/`pause`/`stop`/`playbackParams` оригинала — подписка на стор
//     (`play` — смена трека или запуск, `stop` — трек снят, `playbackParams` — скорость,
//     `loop`, `round`); `getPlayingDetails` — трек стора и его элемент (`getMedia`).
//  2. Подробности трека — `AudioTrack`, а не документ и сообщение: заголовок музыки —
//     `track.title`, исполнитель — `track.performer`; у голосового и кружка — автор
//     (`track.fromId`) и дата (`track.date`). Длительность — элемента (`useAudioStore.duration`).
//  3. Нет предметов: «сохранённая музыка» (`openSavedMusicTab`, `isSavedMusic`), локальные
//     треки поиска музыки (`isLocal`, `inert`), вложения опроса (`isSlotted`), контекст
//     поиска очереди (`getSearchContext`: отложенные/тред), «непрерываемая активность»
//     воркера (`toggleUninteruptableActivity`), буст громкости голосовых (`setMaxVolume`).
import { createSignal, type JSX } from 'solid-js'
import type { Managers } from '@/client/bootstrap'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import PeerTitle from '@components/chat/peerTitle'
import I18n, { i18n } from '@lib/langPack'
import { formatFullSentTime } from '@helpers/date'
import MediaProgressLine from '@components/mediaProgressLine'
import VolumeSelector from '@components/volumeSelector'
import wrapEmojiText from '@lib/richtext/wrapEmojiText'
import toHHMMSS from '@helpers/string/toHHMMSS'
import { PlaybackRateButton } from '@components/playbackRateButton'
import createAudioAnimatedIcon, { createPlayPauseIcon } from '@components/audioAnimatedIcon'
import { doubleRaf } from '@helpers/schedulers'
import ListenerSetter from '@helpers/listenerSetter'
import { setTransition } from '@core/dom/setTransition'
import type { AppImManager } from '@lib/appImManager'
import findUpClassName from '@helpers/dom/findUpClassName'
import toggleDisability from '@helpers/dom/toggleDisability'
import TopbarPlate, { createTopbarPlate } from '@components/chat/topbarPlate.solid'
import Button from '@components/buttonTsx.solid'
import classNames from '@helpers/string/classNames'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import type { IconName } from '@core/tgico-icons'
import { mediaPlayback, playbackMediaType } from '@core/audio/mediaPlaybackController'
import { useAudioStore, type AudioTrack } from '@stores/audioStore'

export type ChatAudioController = {
  container: HTMLElement,
  destroy: () => void
}

/** Расхождение 1: `getPlaybackParams` оригинала. */
const getPlaybackParams = () => {
  const { rate, loop, round } = useAudioStore.getState()
  return { playbackRate: rate, loop, round }
}

export default function createChatAudio(
  appImManager: Pick<AppImManager, 'setInnerPeer'>,
  managers: Managers,
): ChatAudioController {
  const listenerSetter = new ListenerSetter()

  // ───────────────────────── Reactive state ─────────────────────────

  const [title, setTitle] = createSignal<JSX.Element>()
  const [subtitle, setSubtitle] = createSignal<JSX.Element>()
  const [timeText, setTimeText] = createSignal('')
  // the seek glyphs rest on their finished frame and replay on every press
  const rewindIcon = createAudioAnimatedIcon('rewind')
  const forwardIcon = createAudioAnimatedIcon('forward')
  let playIconContainer!: HTMLDivElement
  const setPlayIcon = createPlayPauseIcon(() => playIconContainer)

  // The controller announces a play one task late, so a press that lands inside that gap is told
  // about a play that is already over, and the glyph sits out the change. The media itself is never
  // late, so the plate follows it directly — the same rule the row's button follows.
  const mediaListenerSetter = new ListenerSetter()
  let playingMedia: HTMLMediaElement | undefined
  const [playing, setPlaying] = createSignal(false)
  const syncPlayIcon = () => {
    const isPlaying = !!playingMedia && !playingMedia.paused
    setPlaying(isPlaying)
    setPlayIcon(isPlaying)
  }

  const followMedia = (media: HTMLMediaElement) => {
    if(playingMedia !== media) {
      mediaListenerSetter.removeAll()
      playingMedia = media;
      (['play', 'pause', 'emptied'] as const).forEach((event) => {
        mediaListenerSetter.add(media)(event, syncPlayIcon)
      })
    }

    syncPlayIcon()
  }

  const [repeatIcon, setRepeatIcon] = createSignal<IconName>('audio_repeat')

  // Refs to JSX-rendered buttons that need imperative classList toggles or
  // disability state changes after the initial render.
  let prevEl!: HTMLElement
  let nextEl!: HTMLElement
  let repeatEl!: HTMLElement

  // ───────────────────────── Imperative widgets ─────────────────────────

  const playbackRateButton = PlaybackRateButton({ direction: 'bottom-left' })

  const volumeSelector = new VolumeSelector({ listenerSetter, vertical: true, useGlobalVolume: 'auto' })
  const volumeProgressLineContainer = document.createElement('div')
  volumeProgressLineContainer.classList.add('progress-line-container')
  volumeProgressLineContainer.append(volumeSelector.container)
  const tunnel = document.createElement('div')
  tunnel.classList.add('pinned-audio-volume-tunnel')
  volumeSelector.btn.classList.add('pinned-audio-volume')
  volumeSelector.btn.prepend(tunnel)
  volumeSelector.btn.append(volumeProgressLineContainer)

  const progressLine = new MediaProgressLine({
    withTransition: true,
    useTransform: true,
    onTimeUpdate: (t) => setTimeText(toHHMMSS(t, true)),
  })
  progressLine.container.classList.add('pinned-audio-progress')

  // ───────────────────────── Plate ─────────────────────────

  // The audio plate uses its own visibility logic (`is-visible` + `body.is-pinned-audio-shown`)
  // wired below in `toggle()`. The default `hide` class would conflict with the SCSS
  // `:not(.is-visible) { display: none !important }` rule, so we keep the plate root unmarked.
  const plate = createTopbarPlate({
    modifier: 'audio',
    height: 48,
    initiallyHidden: false,
    render: () => (
      <>
        <TopbarPlate.Body noRipple>
          <Button
            ref={(el) => { prevEl = el }}
            class="btn-icon"
            noRipple
            aria-label={I18n.format('KeyboardShortcuts.Action.PreviousMedia', true)}
            onClick={(e) => { cancelEvent(e); rewindIcon.play(); useAudioStore.getState().prev() }}
          >
            {rewindIcon.element}
          </Button>
          <Button
            class="btn-icon pinned-audio-ico"
            noRipple
            aria-label={I18n.format(playing() ? 'Pause' : 'Play', true)}
            onClick={(e) => { cancelEvent(e); useAudioStore.getState().toggle() }}
          >
            <div class="pinned-audio-play-icon" ref={(el) => { playIconContainer = el }} />
          </Button>
          <Button
            ref={(el) => { nextEl = el }}
            class="btn-icon"
            noRipple
            aria-label={I18n.format('KeyboardShortcuts.Action.NextMedia', true)}
            onClick={(e) => { cancelEvent(e); forwardIcon.play(); useAudioStore.getState().next() }}
          >
            {forwardIcon.element}
          </Button>
          <TopbarPlate.Content class={classNames('hover-effect')} ripple clickable>
            <TopbarPlate.Title>{title()}</TopbarPlate.Title>
            <TopbarPlate.Subtitle>
              <span class="pinned-audio-time">{timeText()}</span>
              {' • '}
              {subtitle()}
            </TopbarPlate.Subtitle>
          </TopbarPlate.Content>
          <div class="pinned-container-wrapper-utils pinned-audio-wrapper-utils">
            {volumeSelector.btn}
            {playbackRateButton.element}
            <Button.Icon
              ref={(el) => { repeatEl = el }}
              icon={repeatIcon()}
              noRipple
              aria-label={I18n.format('Schedule.Repeat', true)}
              onClick={(e) => {
                cancelEvent(e)
                const params = getPlaybackParams()
                if(!params.round) {
                  mediaPlayback.setRound(true)
                } else if(params.loop) {
                  mediaPlayback.setRound(false)
                  mediaPlayback.setLoop(false)
                } else {
                  mediaPlayback.setLoop(!params.loop)
                }
              }}
            />
            <TopbarPlate.CloseButton
              onClick={() => useAudioStore.getState().close()}
            />
          </div>
        </TopbarPlate.Body>
        <div class="pinned-audio-progress-wrapper">
          {progressLine.container}
        </div>
      </>
    ),
  })

  // Click on the central content (title/subtitle) → open the source chat.
  // Clicks anywhere else on the plate do nothing.
  attachClickEvent(plate.container, (e) => {
    if(!findUpClassName(e.target as HTMLElement, 'pinned-container-content')) {
      return
    }

    const mid = +plate.container.dataset.mid!
    const peerId = +plate.container.dataset.peerId!
    if(!peerId) {
      return
    }

    // расхождение 3: контекста поиска очереди (отложенные, тред) нет
    void appImManager.setInnerPeer({
      peerId,
      lastMsgId: mid,
    })
  }, { listenerSetter })

  // ───────────────────────── State / event handlers ─────────────────────────

  function toggle(hide?: boolean): void {
    const current = !plate.container.classList.contains('is-visible')
    if((hide ??= !current) === current) return

    setTransition({
      element: plate.container,
      duration: 250,
      className: 'is-visible',
      forwards: !hide,
      onTransitionStart: () => {
        void doubleRaf().then(() => {
          document.body.classList.toggle('is-pinned-audio-shown', !hide)
        })
      },
    })
  }

  const onPlaybackParams = (playbackParams: ReturnType<typeof getPlaybackParams>) => {
    playbackRateButton.setIcon()
    playbackRateButton.element.classList.toggle('active', playbackParams.playbackRate !== 1)
    setRepeatIcon(playbackParams.loop ? 'audio_repeat_single' : 'audio_repeat')
    repeatEl.classList.toggle('active', playbackParams.loop || playbackParams.round)
  }

  let titleMiddlewareHelper: MiddlewareHelper | undefined
  const onMediaPlay = (track: AudioTrack, media: HTMLMediaElement) => {
    let titleVal: JSX.Element, subtitleVal: JSX.Element
    // расхождение 2: вид — у трека (`playbackMediaType`), а не у документа
    const isMusic = playbackMediaType(track) === 'audio'
    titleMiddlewareHelper?.destroy()
    titleMiddlewareHelper = getMiddleware()
    if(!isMusic) {
      titleVal = new PeerTitle({ peerId: track.fromId ?? track.peerId, middleware: titleMiddlewareHelper.get(), managers }).element
      subtitleVal = track.date ? formatFullSentTime(track.date) : ''
    } else {
      titleVal = wrapEmojiText(track.title)
      subtitleVal = track.performer ? wrapEmojiText(track.performer) : i18n('AudioUnknownArtist')
    }

    repeatEl.classList.toggle('hide', !isMusic)
    onPlaybackParams(getPlaybackParams())
    volumeSelector.setGlobalVolume()

    progressLine.setMedia({ media, duration: useAudioStore.getState().duration })
    toggleDisability([prevEl, nextEl], !track.peerId)

    plate.container.dataset.peerId = '' + (track.peerId ?? '')
    plate.container.dataset.mid = '' + (track.msgId ?? '')

    setTitle(titleVal)

    // Solid is throwing an error when trying to set the subtitle as a fragment / array of nodes
    const subtitleSpan = document.createElement('span')
    subtitleSpan.append(subtitleVal as Node | string)

    setSubtitle(subtitleSpan)

    followMedia(media)
    toggle(false)
  }

  const onStop = () => toggle(true)

  // расхождение 1: события контроллера — переходы витрины
  const playingDetails = () => {
    const { track } = useAudioStore.getState()
    const media = track && mediaPlayback.getMedia(track.mediaId)
    return track && media ? { track, media } : undefined
  }

  listenerSetter.addCleanup(useAudioStore.subscribe((state, prev) => {
    if(!state.track) {
      if(prev.track) onStop()
    } else if(state.track !== prev.track || (state.playing && !prev.playing)) {
      const details = playingDetails()
      if(details) onMediaPlay(details.track, details.media)
    }

    if(state.rate !== prev.rate || state.loop !== prev.loop || state.round !== prev.round) {
      onPlaybackParams(getPlaybackParams())
    }
  }))

  const details = playingDetails()
  if(details) {
    onMediaPlay(details.track, details.media)
  }

  return {
    container: plate.container,
    destroy: () => {
      progressLine.removeListeners()
      listenerSetter.removeAll()
      mediaListenerSetter.removeAll()
      titleMiddlewareHelper?.destroy()
      plate.destroy()
    },
  }
}
