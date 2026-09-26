/** @jsxImportSource solid-js */
// Пины общей шапки `components/mediaHeader.solid.tsx` (порт tweb
// `components/mediaHeader.tsx` 812502980; до волны 2D жила в `auth/`).
//
// Ветка `name` у `Sticker` (Этап 2 плана «один
// движок lottie», docs/superpowers/plans/2026-09-05-lottie-single-engine.md).
// Внутренняя механика `LottieAnimation` (--size, restartOnClick,
// onCleanup→remove, гонка «промис срабатывает после cleanup») уже
// исчерпывающе пином в `lottieAnimation.solid.test.tsx` — здесь проверяется
// ТОЛЬКО проводка слота: мокаем сам `LottieAnimation` (а не
// `@lib/lottie/lottieLoader`, как в тестах Этапа 1) и читаем пропы, с
// которыми `Sticker` его вызывает.
//
// Причина мокать именно так: `vi.fn().mockRejectedValue(...)` внутри
// оборачивает результат собственной бухгалтерией (`mock.results`) и потому
// НИКОГДА не всплывает как настоящий Unhandled Rejection — попытка поймать
// пропажу `onPromise`-катча через `@lib/lottie/lottieLoader`-мок и глобальный
// `process.on('unhandledRejection')` молчала одинаково что с катчем, что без
// него (проверено вручную при подготовке этого файла). Мокая сам
// `LottieAnimation`, тест зовёт `onPromise` НАСТОЯЩИМ `Promise.reject(...)` —
// такой промис Node размечает по-честному, и пропажа катча ловится.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { LottieAssetName } from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'

type CapturedProps = {
  class?: string
  size?: number
  name?: LottieAssetName
  restartOnClick?: boolean
  onPromise?: (promise: Promise<LottiePlayer>) => void
}

let captured: CapturedProps | undefined

vi.mock('./lottieAnimation.solid', () => ({
  default: (props: CapturedProps) => {
    captured = props
    return <div data-testid="stub-lottie-animation" />
  },
}))

import MediaHeader from './mediaHeader.solid'
import styles from './mediaHeader.module.scss'

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
  captured = undefined
})

describe('MediaHeader.Sticker: ветка name — LottieAnimation вместо ASSETS-карты + lottie-web', () => {
  it('передаёт ИМЯ ассета, размер, класс .lottie и restartOnClick', () => {
    mount(() => <MediaHeader.Sticker size={130} name="Mailbox" />)

    expect(captured).toBeDefined()
    expect(captured!.name).toBe('Mailbox' satisfies LottieAssetName)
    expect(captured!.size).toBe(130)
    expect(captured!.class).toBe(styles.lottie)
    expect(captured!.restartOnClick).toBe(true)
  })

  it('другое имя (другой размер) доезжает без искажений — не захардкожен Mailbox', () => {
    mount(() => <MediaHeader.Sticker size={86} name="UtyanSearch" />)

    expect(captured!.name).toBe('UtyanSearch' satisfies LottieAssetName)
    expect(captured!.size).toBe(86)
  })

  it('onPromise гасит реджект (деградация без WASM SIMD) — не даёт ему остаться необработанным', async () => {
    mount(() => <MediaHeader.Sticker size={130} name="Mailbox" />)

    let unhandled: unknown
    const onUnhandled = (reason: unknown) => { unhandled = reason }
    process.on('unhandledRejection', onUnhandled)
    try {
      // Настоящий Promise.reject — НЕ через vi.fn().mockRejectedValue (см.
      // докблок файла про то, почему мок-обёртка тут не годится).
      captured!.onPromise!(Promise.reject(new Error('NO_WASM')))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(unhandled).toBeUndefined()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('MediaHeader.Sticker: element вместо name (tweb :103-152)', () => {
  it('узел в element кладётся в слот как есть, LottieAnimation не монтируется, onReady — сразу', () => {
    const logo = document.createElement('svg')
    const onReady = vi.fn()
    mount(() => <MediaHeader.Sticker size={120} element={logo} onReady={onReady} />)

    const sticker = host!.firstElementChild as HTMLElement
    expect(sticker.classList.contains(styles.sticker)).toBe(true)
    expect(sticker.style.getPropertyValue('--sticker-size')).toBe('120px')
    expect(sticker.firstElementChild).toBe(logo)
    expect(host!.querySelector('[data-testid="stub-lottie-animation"]')).toBeNull()
    expect(captured).toBeUndefined()
    expect(onReady).toHaveBeenCalledOnce()
    expect(onReady).toHaveBeenCalledWith()
  })

  it('element-функция вызывается один раз и отдаёт свой узел; ref получает обёртку', () => {
    const factory = vi.fn(() => <canvas data-testid="qr" />)
    let wrapper: HTMLDivElement | undefined
    mount(() => <MediaHeader.Sticker element={factory} ref={(el) => { wrapper = el }} class="extra" />)

    expect(factory).toHaveBeenCalledOnce()
    expect(host!.querySelector('[data-testid="qr"]')).not.toBeNull()
    expect(wrapper).toBe(host!.firstElementChild)
    expect(wrapper!.classList.contains('extra')).toBe(true)
    expect(wrapper!.style.getPropertyValue('--sticker-size')).toBe('130px')
  })

  it('restartOnClick={false} доезжает до LottieAnimation, onReady — по готовности плеера', async() => {
    const onReady = vi.fn()
    mount(() => <MediaHeader.Sticker name="Mailbox" restartOnClick={false} onReady={onReady} />)

    expect(captured!.restartOnClick).toBe(false)
    expect(onReady).not.toHaveBeenCalled()
    const player = {} as LottiePlayer
    captured!.onPromise!(Promise.resolve(player))
    await Promise.resolve()
    await Promise.resolve()
    expect(onReady).toHaveBeenCalledWith(player)
  })
})

describe('MediaHeader: блок, заголовок, подзаголовок (tweb :55-97, :158-209)', () => {
  it('флаги блока — классы модуля; Backdrop — свой слой', () => {
    mount(() => (
      <MediaHeader marginTop marginBottom align="start" onBackdrop class="own">
        <MediaHeader.Backdrop class="bd"><i /></MediaHeader.Backdrop>
      </MediaHeader>
    ))

    const block = host!.firstElementChild as HTMLElement
    for (const name of ['marginTop', 'marginBottom', 'alignStart', 'onBackdrop'] as const) {
      expect(block.classList.contains(styles[name])).toBe(true)
    }
    expect(block.classList.contains('own')).toBe(true)
    const backdrop = block.firstElementChild as HTMLElement
    expect(backdrop.classList.contains(styles.backdrop)).toBe(true)
    expect(backdrop.classList.contains('bd')).toBe(true)
  })

  it('Title: тег по tag, data-popup-title, размер 20 — title20', () => {
    mount(() => (
      <>
        <MediaHeader.Title tag="h1">A</MediaHeader.Title>
        <MediaHeader.Title size={20}>B</MediaHeader.Title>
      </>
    ))

    const [h1, div] = [...host!.children] as HTMLElement[]
    expect(h1.tagName).toBe('H1')
    expect(h1.hasAttribute('data-popup-title')).toBe(true)
    expect(h1.classList.contains(styles.title)).toBe(true)
    expect(h1.classList.contains(styles.title20)).toBe(false)
    expect(div.tagName).toBe('DIV')
    expect(div.classList.contains(styles.title20)).toBe(true)
  })

  it('Subtitle: color — класс модуля (secondary/danger), без color — только subtitle', () => {
    mount(() => (
      <>
        <MediaHeader.Subtitle color="secondary">a</MediaHeader.Subtitle>
        <MediaHeader.Subtitle color="danger">b</MediaHeader.Subtitle>
        <MediaHeader.Subtitle>c</MediaHeader.Subtitle>
      </>
    ))

    const [secondary, danger, plain] = [...host!.children] as HTMLElement[]
    expect(secondary.classList.contains(styles.secondary)).toBe(true)
    expect(danger.classList.contains(styles.danger)).toBe(true)
    expect(plain.classList.contains(styles.subtitle)).toBe(true)
    expect(plain.classList.contains(styles.secondary)).toBe(false)
    expect(plain.classList.contains(styles.danger)).toBe(false)
  })
})
