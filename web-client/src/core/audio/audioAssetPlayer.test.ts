// Пины на два места, где наш файл раньше расходился с tweb по ПОВЕДЕНИЮ, а не
// по форме. Оба расхождения выглядели как безобидное упрощение, поэтому и
// пинятся: без теста их «упростят» обратно при первом же касании файла.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AudioAssetPlayer from './audioAssetPlayer'

const ASSETS = { ding: 'ding.mp3', pop: 'pop.mp3' } as const

// happy-dom не реализует HTMLMediaElement.play — подменяем на счётчик.
let plays: HTMLAudioElement[]
beforeEach(() => {
  plays = []
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLAudioElement) {
    plays.push(this)
    return Promise.resolve()
  })
  document.getElementById('audio-asset-player')?.remove()
})

describe('AudioAssetPlayer', () => {
  // tweb :73-75. Запрет автоплея браузер снимает с КОНКРЕТНОГО элемента,
  // тронутого в пользовательском жесте, поэтому оригинал «прогревает» элемент
  // сразу при создании. Без этого первый звук после загрузки страницы молча не
  // играет — а на тестах разницы не видно, отсюда и пин.
  it('элемент прогревается при создании, ещё до подстановки src', () => {
    const player = new AudioAssetPlayer(ASSETS)

    const audio = player.createAudio()

    expect(plays).toContain(audio)
    expect(audio.src).toBe('')
  })

  // tweb :53 сравнивает ВСЕ опции через deepEqual. Наша прежняя версия
  // сравнивала одно имя — и глушила тот же звук с другой громкостью, хотя это
  // другой звук (уведомление тихое и громкое приходят подряд).
  it('троттлинг сравнивает все опции: другая громкость — не тот же звук', () => {
    const player = new AudioAssetPlayer(ASSETS)

    player.playWithThrottle({ name: 'ding', volume: 0.2 }, 10_000)
    const afterFirst = plays.length
    player.playWithThrottle({ name: 'ding', volume: 0.2 }, 10_000) // тот же — глушится
    const afterSame = plays.length
    player.playWithThrottle({ name: 'ding', volume: 1 }, 10_000)   // другой — играет

    expect(afterSame).toBe(afterFirst)
    expect(plays.length).toBeGreaterThan(afterSame)
  })

  it('троттлинг всё-таки глушит повтор в окне', () => {
    const player = new AudioAssetPlayer(ASSETS)

    player.playWithThrottle({ name: 'pop' }, 10_000)
    const after = plays.length
    player.playWithThrottle({ name: 'pop' }, 10_000)

    expect(plays.length).toBe(after)
  })
})
