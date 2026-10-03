// Плашка аудиоплеера — порт tweb `chat/audio.tsx`: показ по запуску трека и прятание по
// остановке, заголовок по виду трека, play/pause/следующий/предыдущий/закрыть зовут
// контроллер, глиф кнопки следует за самим элементом, повтор перебирает round → loop → выкл,
// клик по названию открывает сообщение. Контроллер и витрина — настоящие; действия витрины,
// которые проверяются фактом вызова, подменены шпионами.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import { useAudioStore, type AudioTrack } from '@stores/audioStore'
import { useSettingsStore } from '@/settings'
import { mediaPlayback, resetPlayback } from '@core/audio/mediaPlaybackController'
import type { Managers } from '@/client/bootstrap'
import createChatAudio, { type ChatAudioController } from './audio.solid'

const music: AudioTrack = { mediaId: 11, title: 'Song', performer: 'Band', peerId: 5, msgId: 70, type: 'audio' }
const voice: AudioTrack = { mediaId: 12, title: '', date: 1755255240, fromId: 3, peerId: 5, msgId: 71, type: 'voice' }

let plate: ChatAudioController
let setInnerPeer: ReturnType<typeof vi.fn<(options: { peerId: PeerId, lastMsgId?: number }) => unknown>>
let media: HTMLAudioElement
const original = useAudioStore.getState()
const spies = {
  toggle: vi.fn<() => void>(),
  next: vi.fn<() => void>(),
  prev: vi.fn<() => void>(),
  close: vi.fn<() => void>(),
}

function startTrack(track: AudioTrack) {
  media = document.createElement('audio')
  mediaPlayback.addMedia({ track, element: media })
  useAudioStore.setState({ track, queue: [track], index: 0, playing: true, duration: 30 })
}

const button = (label: string) => Array.from(plate.container.querySelectorAll<HTMLElement>('button'))
  .find((b) => b.getAttribute('aria-label') === label)!

// happy-dom не знает SMIL: глифы перемотки (`audioAnimatedIcon.ts`, ветка без Web Animations)
// зовут `beginElement` на нажатии
if(!('beginElement' in SVGElement.prototype)) {
  Object.defineProperty(SVGElement.prototype, 'beginElement', { configurable: true, value: () => {} })
}

beforeEach(() => {
  // без анимаций переход `is-visible` применяется синхронно (tweb singleTransition.ts:67)
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  useAudioStore.setState({ ...spies })
  Object.values(spies).forEach((spy) => spy.mockClear())
  setInnerPeer = vi.fn()
  plate = createChatAudio({ setInnerPeer } as never, { peers: { fillMirror: vi.fn(async() => {}) } } as unknown as Managers)
  document.body.append(plate.container)
})

afterEach(() => {
  plate.destroy()
  useAudioStore.setState({ ...original, track: null, queue: [], index: -1, playing: false })
  resetPlayback()
  document.body.classList.remove('is-pinned-audio-shown')
})

describe('плашка аудиоплеера', () => {
  it('запуск музыки показывает плашку с названием и исполнителем, остановка — прячет', () => {
    expect(plate.container.classList.contains('is-visible')).toBe(false)

    startTrack(music)
    expect(plate.container.className).toContain('pinned-container pinned-audio')
    expect(plate.container.classList.contains('is-visible')).toBe(true)
    expect(plate.container.querySelector('.pinned-audio-title')!.textContent).toBe('Song')
    expect(plate.container.querySelector('.pinned-audio-subtitle')!.textContent).toContain('Band')
    // повтор — только у музыки (tweb audio.tsx:229)
    expect(button('Repeat').classList.contains('hide')).toBe(false)

    useAudioStore.setState({ track: null, playing: false })
    expect(plate.container.classList.contains('is-visible')).toBe(false)
  })

  it('голосовое: заголовок — автор, без кнопки повтора', () => {
    startTrack(voice)
    expect(plate.container.querySelector('.pinned-audio-title .peer-title')).not.toBeNull()
    expect(button('Repeat').classList.contains('hide')).toBe(true)
  })

  it('play/pause зовёт контроллер, а глиф и подпись кнопки следуют за элементом', () => {
    startTrack(music)
    const play = plate.container.querySelector<HTMLElement>('.pinned-audio-ico')!
    // элемент ещё не играет — кнопка предлагает «Play»
    expect(play.getAttribute('aria-label')).toBe('Play')

    play.click()
    expect(spies.toggle).toHaveBeenCalledTimes(1)

    media.dispatchEvent(new Event('play'))
    Object.defineProperty(media, 'paused', { configurable: true, get: () => false })
    media.dispatchEvent(new Event('play'))
    expect(play.getAttribute('aria-label')).toBe('Pause')
    expect(play.querySelector('.pinned-audio-play-icon .audio-animated-icon')).not.toBeNull()
  })

  it('следующий и предыдущий трек, закрытие', () => {
    startTrack(music)
    button('Next media').click()
    expect(spies.next).toHaveBeenCalledTimes(1)
    button('Previous media').click()
    expect(spies.prev).toHaveBeenCalledTimes(1)

    plate.container.querySelector<HTMLElement>('.pinned-audio-close')!.click()
    expect(spies.close).toHaveBeenCalledTimes(1)
  })

  it('повтор перебирает: плейлист → трек → выкл', () => {
    startTrack(music)
    const repeat = button('Repeat')

    repeat.click()
    expect(useAudioStore.getState()).toMatchObject({ round: true, loop: false })
    expect(repeat.classList.contains('active')).toBe(true)

    repeat.click()
    expect(useAudioStore.getState()).toMatchObject({ round: true, loop: true })
    expect(repeat.classList.contains('audio_repeat_single')).toBe(true)

    repeat.click()
    expect(useAudioStore.getState()).toMatchObject({ round: false, loop: false })
    expect(repeat.classList.contains('active')).toBe(false)
  })

  it('клик по названию открывает сообщение трека', () => {
    startTrack(music)
    plate.container.querySelector<HTMLElement>('.pinned-audio-content')!.click()
    expect(setInnerPeer).toHaveBeenCalledWith({ peerId: 5, lastMsgId: 70 })
  })
})
