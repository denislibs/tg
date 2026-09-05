/** @jsxImportSource solid-js */
// Тесты порта `lottieAnimation.solid.tsx` (tweb `components/lottieAnimation.tsx`,
// см. докблок компонента для построчных ссылок).
//
// Пины:
//  1. `--size` в style контейнера и вызов `lottieLoader.loadAnimationAsAsset`
//     с реальным именем ассета и размерами — единственная точка входа для
//     встроенных ассетов не должна тихо разойтись сигнатурой с оригиналом.
//  2. `restartOnClick` — клик перезапускает уже загруженную анимацию
//     (`animation.playOrRestart()`), без пропа — клик ничего не делает.
//  3. `onCleanup` — снятая с DOM анимация зовёт `animation.remove()` (иначе
//     плеер и его канва/воркер-ресурсы утекают при размонтировании узла).
//  4. Расхождение с tweb, объявленное в докблоке: `lottieLoader` необязателен
//     и по умолчанию берёт синглтон `@lib/lottie/lottieLoader` (в оригинале
//     проп обязателен и приходит из `useHotReloadGuard()`, которого у нас нет).
//  5. `needRaf` — дословный порт (tweb `lottieAnimation.tsx:38-42`): пока узел
//     не в DOM, загрузка откладывается на `requestAnimationFrame` и не зовёт
//     `loadAnimationAsAsset` вовсе; как только узел подключается — грузит.
//     У нас на момент Этапа 5 нет ни одного потребителя с `needRaf` (найдено
//     финальным ревью программы), поэтому без этого теста ветка не краснела
//     бы ни при каком сносе.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { LottieLoader } from '@lib/lottie/lottieLoader'
import defaultLottieLoader from '@lib/lottie/lottieLoader'
import LottieAnimation from './lottieAnimation.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function mount(component: () => unknown) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(component as () => never, host)
  return host
}

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

function fakePlayer() {
  return {
    playOrRestart: vi.fn(),
    remove: vi.fn(),
  }
}

function fakeLoader(player: ReturnType<typeof fakePlayer>) {
  const loadAnimationAsAsset = vi.fn().mockResolvedValue(player)
  const loader = { loadAnimationAsAsset } as unknown as LottieLoader
  return { loader, loadAnimationAsAsset }
}

describe('LottieAnimation — единственная точка входа для встроенных ассетов', () => {
  it('грузит ассет по имени с заданным размером и ставит --size на контейнер', () => {
    const player = fakePlayer()
    const { loader, loadAnimationAsAsset } = fakeLoader(player)

    const el = mount(() => (
      <LottieAnimation lottieLoader={loader} name="UtyanPasscode" size={64} />
    ))
    const div = el.firstElementChild as HTMLDivElement

    expect(div.style.getPropertyValue('--size')).toBe('64px')
    expect(loadAnimationAsAsset).toHaveBeenCalledTimes(1)
    const [params, name] = loadAnimationAsAsset.mock.calls[0]
    expect(name).toBe('UtyanPasscode')
    expect(params).toMatchObject({ container: div, width: 64, height: 64, autoplay: true, loop: false })
  })

  it('restartOnClick: клик перезапускает загруженную анимацию', async () => {
    const player = fakePlayer()
    const { loader } = fakeLoader(player)

    const el = mount(() => (
      <LottieAnimation lottieLoader={loader} name="UtyanPasscode" restartOnClick />
    ))
    const div = el.firstElementChild as HTMLDivElement

    // дождаться резолва animationPromise, назначенного в эффекте загрузки
    await Promise.resolve()
    await Promise.resolve()

    div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()

    expect(player.playOrRestart).toHaveBeenCalledTimes(1)
  })

  it('без restartOnClick клик не трогает анимацию', async () => {
    const player = fakePlayer()
    const { loader } = fakeLoader(player)

    const el = mount(() => <LottieAnimation lottieLoader={loader} name="UtyanPasscode" />)
    const div = el.firstElementChild as HTMLDivElement

    await Promise.resolve()
    await Promise.resolve()

    div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()

    expect(player.playOrRestart).not.toHaveBeenCalled()
  })

  it('размонтирование зовёт animation.remove()', async () => {
    const player = fakePlayer()
    const { loader } = fakeLoader(player)

    mount(() => <LottieAnimation lottieLoader={loader} name="UtyanPasscode" />)

    await Promise.resolve()
    await Promise.resolve()

    dispose?.()
    dispose = undefined
    await Promise.resolve()

    expect(player.remove).toHaveBeenCalledTimes(1)
  })

  it('реджект загрузки (NO_WASM) + размонтирование — onCleanup не рожает свой необработанный промис (Этап 2)', async () => {
    const { loader, loadAnimationAsAsset } = fakeLoader(fakePlayer())
    loadAnimationAsAsset.mockRejectedValue(new Error('NO_WASM'))

    mount(() => <LottieAnimation lottieLoader={loader} name="UtyanPasscode" />)

    await Promise.resolve()
    await Promise.resolve()

    dispose?.()
    dispose = undefined
    await Promise.resolve()
    // без второго аргумента у `onCleanup`'s `.then()` (см. комментарий у
    // строки в компоненте) этот прогон дал бы Unhandled Rejection.
  })

  it('needRaf: не грузит, пока узел не подключён к DOM, грузит после подключения (tweb lottieAnimation.tsx:38-42)', async () => {
    const player = fakePlayer()
    const { loader, loadAnimationAsAsset } = fakeLoader(player)

    // Контейнер НЕ добавлен в document — узел, который рендерит компонент,
    // остаётся отключённым от DOM (`isConnected === false`).
    const detachedHost = document.createElement('div')
    const localDispose = render(
      () => <LottieAnimation lottieLoader={loader} name="UtyanPasscode" needRaf />,
      detachedHost,
    )
    const div = detachedHost.firstElementChild as HTMLDivElement

    await Promise.resolve()
    expect(div.isConnected).toBe(false)
    expect(loadAnimationAsAsset).not.toHaveBeenCalled()

    document.body.append(detachedHost)
    expect(div.isConnected).toBe(true)
    // requestAnimationFrame, запланированный в первом заходе loadAnimation(),
    // срабатывает следующим кадром.
    await new Promise((r) => requestAnimationFrame(r))

    expect(loadAnimationAsAsset).toHaveBeenCalledTimes(1)

    localDispose()
    detachedHost.remove()
  })

  it('без lottieLoader-пропа использует синглтон @lib/lottie/lottieLoader (расхождение с tweb объявлено в докблоке)', () => {
    const spy = vi.spyOn(defaultLottieLoader, 'loadAnimationAsAsset').mockReturnValue(
      new Promise(() => {}), // не резолвим — в тесте важен только факт вызова на синглтоне
    )
    try {
      mount(() => <LottieAnimation name="UtyanPasscode" />)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })
})
