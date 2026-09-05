/** @jsxImportSource solid-js */
// Пины `MediaHeader.solid.tsx::Sticker` — ветка `name` (Этап 2 плана «один
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

vi.mock('../lottieAnimation.solid', () => ({
  default: (props: CapturedProps) => {
    captured = props
    return <div data-testid="stub-lottie-animation" />
  },
}))

import MediaHeader from './MediaHeader.solid'
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

describe('MediaHeader.Sticker: без name — прежнее поведение (children)', () => {
  it('рендерит children и НЕ монтирует LottieAnimation', () => {
    mount(() => <MediaHeader.Sticker size={120}>{<svg data-testid="logo" />}</MediaHeader.Sticker>)
    expect(host!.querySelector('svg')).not.toBeNull()
    expect(host!.querySelector('[data-testid="stub-lottie-animation"]')).toBeNull()
    expect(captured).toBeUndefined()
  })
})
