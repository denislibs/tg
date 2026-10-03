// Порт tweb `src/components/volumeSelector.ts` (VolumeSelector — наследник
// RangeSelector) в объёме vanilla-плеера вьювера (Task 15): кнопка
// `div.btn-icon.player-volume` (иконка + слайдер внутри, ширина раскрывается
// ховером из партиала _ckin.scss), пороги иконок tweb (off/mute/down/up),
// mute-клик по иконке, скраб громкости.
//
// `useGlobalVolume: 'auto'` (tweb :20-26, :45-86, :105-120, :176-180) — селектор без своего
// элемента, привязанный к громкости контроллера голоса/музыки
// (`core/audio/mediaPlaybackController.ts`, витрина `useAudioStore`): им пользуется плашка
// аудиоплеера (`chat/audio.solid.tsx`, П-5 волны 7). Глобальное событие `playbackParams`
// оригинала — подписка на `useAudioStore`.
//
// Не портированы (помечено):
//   • `useGlobalVolume: 'no-init'` и глобальная громкость вьювера — громкость видео
//     вьювера НЕ персистится, ровно как в снесённом (Task 16) React-плеере лайтбокса,
//     персист скорости — на плеере;
//   • maxVolume > 1 (буст голосовых) и setMaxVolume — буста у контроллера нет.
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import type ListenerSetter from '@helpers/listenerSetter'
import safeAssign from '@helpers/object/safeAssign'
import type { IconName } from '@core/tgico-icons'
import { replaceButtonIcon } from './mediaViewer/base'
import RangeSelector from './rangeSelector'
import { useAudioStore } from '@stores/audioStore'

const className = 'player-volume'

export default class VolumeSelector extends RangeSelector {
  private static ICONS: IconName[] = ['volume_off_filled', 'volume_mute_filled', 'volume_down_filled', 'volume_up_filled']
  public btn: HTMLElement
  protected listenerSetter!: ListenerSetter
  protected media?: HTMLMediaElement
  protected useGlobalVolume?: 'auto'
  private ignoreGlobalEvents?: boolean

  constructor(options: {
    listenerSetter: ListenerSetter,
    vertical?: boolean,
    media?: HTMLMediaElement,
    useGlobalVolume?: 'auto'
  }) {
    super({
      step: 0.01,
      min: 0,
      max: 1,
      vertical: options.vertical,
    }, 1)

    safeAssign(this, options)

    this.setListeners()
    this.setHandlers({
      onScrub: (_value) => {
        const value = Math.max(Math.min(_value, this.max), 0)

        if (this.useGlobalVolume) {
          this.modifyGlobal(() => {
            const state = useAudioStore.getState()
            if (state.muted) state.toggleMute()
            state.setVolume(value)
          })
        }

        this.setVolume({ volume: value, muted: false })
      },
    })

    const btn = this.btn = document.createElement('div')
    btn.classList.add('btn-icon', className)

    attachClickEvent(btn, (e) => {
      if (!findUpClassName(e.target as HTMLElement, className + '__icon') && e.target !== this.btn) {
        return
      }

      this.onMuteClick(e)
    }, { listenerSetter: this.listenerSetter })

    if (this.useGlobalVolume) {
      this.listenerSetter.addCleanup(useAudioStore.subscribe((state, prev) => {
        if (this.ignoreGlobalEvents || (state.volume === prev.volume && state.muted === prev.muted)) {
          return
        }

        this.setVolume({ volume: state.volume, muted: state.muted })
      }))

      this.setGlobalVolume()
    } else if (this.media) {
      this.setVolume({ volume: this.media.volume, muted: this.media.muted })
    }

    btn.append(this.container)
  }

  private modifyGlobal(callback: () => void) {
    this.ignoreGlobalEvents = true
    callback()
    this.ignoreGlobalEvents = false
  }

  /** tweb :176-180 */
  public setGlobalVolume = () => {
    const { volume, muted } = useAudioStore.getState()
    this.setVolume({ volume, muted })
  }

  // В tweb protected (клавишу M обслуживает глобальный контроллер); у нас его
  // зовёт и хоткей M плеера (lib/mediaPlayer) — потому public.
  public onMuteClick(e?: Event) {
    if (e) cancelEvent(e)

    const global = useAudioStore.getState()
    const { volume, muted } = this.media ?? (this.useGlobalVolume ? global : { volume: 1, muted: false })

    if (this.useGlobalVolume) {
      this.modifyGlobal(() => {
        global.toggleMute()
      })
    }

    this.setVolume({
      volume,
      muted: !muted,
    })
  }

  public setVolume = ({ volume, muted }: { volume: number, muted: boolean }) => {
    let iconIndex: number
    if (!volume || muted) {
      iconIndex = 0
    } else if (volume > .5) {
      iconIndex = 3
    } else if (volume > 0 && volume < .25) {
      iconIndex = 1
    } else {
      iconIndex = 2
    }

    const newIcon = replaceButtonIcon(this.btn, VolumeSelector.ICONS[iconIndex])
    newIcon.classList.add(className + '__icon')

    if (this.media) {
      // HTMLMediaElement принимает только [0, 1] (комментарий tweb)
      this.media.volume = Math.min(volume, 1)
      this.media.muted = muted
    }

    if (!this.mousedown) {
      this.setProgress(muted ? 0 : volume)
    }
  }
}
