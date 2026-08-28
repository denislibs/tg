// Порт tweb `helpers/audioAssetPlayer.ts`. Короткие UI-звуки из
// `public/assets/audio` (отправка сообщения, уведомление, тоны звонка). К
// контроллеру воспроизведения медиа отношения не имеет — в tweb это тоже
// отдельный файл со своим скрытым контейнером.
//
// Единственное расхождение с оригиналом: контейнер вешается на `document.body`,
// а не в `getOverlayRoot()`. У tweb есть понятие вынесенного окна (popout), у
// нас его нет, и заводить пустой оверлей-рут ради совпадения строки — отсебятина.
//
// Отличие в лучшую сторону, сохранено сознательно: в `console.error` уходит
// `options.name`, а не глобальный `name` (tweb `:47` печатает `window.name` —
// там это опечатка).
import safePlay from '@helpers/dom/safePlay'
import deepEqual from '@helpers/object/deepEqual'
import tsNow from '@helpers/tsNow'

const ASSETS_PATH = `${import.meta.env.BASE_URL}assets/audio/`

interface PlayOptions<AssetMap extends Record<string, string>> {
  name: keyof AssetMap
  loop?: boolean
  volume?: number
}

export default class AudioAssetPlayer<AssetMap extends Record<string, string>> {
  private static container: HTMLElement
  // `!` — только из-за нашего strictPropertyInitialization, которого нет в
  // конфиге tweb: поля заполняются при первом `play`, форма кода оригинальная.
  private audio!: HTMLAudioElement
  private tempId: number
  private assetName!: keyof AssetMap
  private lastOptions!: PlayOptions<AssetMap>
  private nextAt!: number

  constructor(private assets: AssetMap) {
    this.tempId = 0

    if (!AudioAssetPlayer.container) {
      AudioAssetPlayer.container = document.createElement('div')
      AudioAssetPlayer.container.id = 'audio-asset-player'
      document.body.append(AudioAssetPlayer.container)
    }
  }

  public play(options: PlayOptions<AssetMap>): void {
    ++this.tempId
    this.assetName = options.name
    this.lastOptions = options

    try {
      const audio = this.createAudio()
      audio.autoplay = true
      audio.src = ASSETS_PATH + this.assets[options.name]
      audio.loop = options.loop ?? false
      audio.volume = options.volume ?? 1
      audio.setAttribute('name', options.name as string)
      AudioAssetPlayer.container.append(audio)
      safePlay(audio)
    } catch (e) {
      console.error('playSound', options.name, e)
    }
  }

  /** Не повторять звук чаще, чем раз в `throttle` мс. Сравниваются ВСЕ опции
   *  (tweb `deepEqual`), а не одно имя: тот же звук с другой громкостью — это
   *  другой звук, и глушить его нельзя. */
  public playWithThrottle(options: PlayOptions<AssetMap>, throttle: number): void {
    const now = tsNow()
    if (this.nextAt && now < this.nextAt && deepEqual(this.lastOptions, options)) {
      return
    }

    this.nextAt = now + throttle
    this.play(options)
  }

  public playIfDifferent(options: PlayOptions<AssetMap>): void {
    if (this.assetName !== options.name) {
      this.play(options)
    }
  }

  /** `safePlay` на только что созданном элементе — не описка: браузер снимает
   *  запрет автоплея с КОНКРЕТНОГО элемента, тронутого в жесте пользователя,
   *  поэтому оригинал «прогревает» его сразу при создании (tweb `:73-75`). Без
   *  этого первый звук после загрузки страницы молча не играет. */
  public createAudio(): HTMLAudioElement {
    let { audio } = this
    if (audio) {
      return audio
    }

    audio = this.audio = new Audio()
    safePlay(audio)
    return audio
  }

  public stop(): void {
    if (!this.audio) {
      return
    }

    this.audio.pause()
  }

  public cancelDelayedPlay(): void {
    ++this.tempId
  }

  public playWithTimeout(options: PlayOptions<AssetMap>, timeout: number): void {
    const tempId = ++this.tempId
    setTimeout(() => {
      if (this.tempId !== tempId) {
        return
      }

      this.play(options)
    }, timeout)
  }
}
