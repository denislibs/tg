// Порт tweb `src/components/volumeSelector.ts` (VolumeSelector — наследник
// RangeSelector) в объёме vanilla-плеера вьювера (Task 15): кнопка
// `div.btn-icon.player-volume` (иконка + слайдер внутри, ширина раскрывается
// ховером из партиала _ckin.scss), пороги иконок tweb (off/mute/down/up),
// mute-клик по иконке, скраб громкости.
//
// Не портированы (помечено):
//   • useGlobalVolume / appMediaPlaybackController — глобальная громкость у нас
//     обслуживает только голос/музыку (core/audio/mediaPlaybackController.ts);
//     громкость видео вьювера НЕ персистится — ровно как в снесённом (Task 16)
//     React-плеере лайтбокса, персист скорости — на плеере;
//   • maxVolume > 1 (буст голосовых) и setMaxVolume — потребителя нет.
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import type ListenerSetter from '@helpers/listenerSetter'
import safeAssign from '@helpers/object/safeAssign'
import type { IconName } from '@core/tgico-icons'
import { replaceButtonIcon } from './mediaViewer/base'
import RangeSelector from './rangeSelector'

const className = 'player-volume'

export default class VolumeSelector extends RangeSelector {
  private static ICONS: IconName[] = ['volume_off', 'volume_mute', 'volume_down', 'volume_up']
  public btn: HTMLElement
  protected listenerSetter!: ListenerSetter
  protected media?: HTMLMediaElement

  constructor(options: {
    listenerSetter: ListenerSetter,
    vertical?: boolean,
    media?: HTMLMediaElement
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

    if (this.media) {
      this.setVolume({ volume: this.media.volume, muted: this.media.muted })
    }

    btn.append(this.container)
  }

  // В tweb protected (клавишу M обслуживает глобальный контроллер); у нас его
  // зовёт и хоткей M плеера (lib/mediaPlayer) — потому public.
  public onMuteClick(e?: Event) {
    if (e) cancelEvent(e)

    const { volume, muted } = this.media ?? { volume: 1, muted: false }

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
