// Пин снятия упавшего lottie-плеера с animationIntersector
// (порт tweb `lib/lottie/lottieLoader.ts:352-356`).
//
// Почему это не «лишний вызов»: `loadAnimationWorker` регистрирует плеер в
// интерсекторе БЕЗУСЛОВНО, а автоснятие есть только у `controlled: middleware`.
// Плеер без middleware, упавший на загрузке, иначе остаётся в byPlayer/
// byGroups/byElement навсегда: элемент продолжает наблюдаться, а checkAnimations
// дёргает play/pause у уничтоженного плеера.
//
// IntersectionObserver в happy-dom нет — подменяем заглушкой (как в
// `animationIntersector.test.ts`).
import { describe, it, expect, vi } from 'vitest'

class IntersectionObserverStub {
  constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

const { default: animationIntersector } = await import('@components/animationIntersector')
const { default: lottieLoader } = await import('@lib/lottie/lottieLoader')

// `initPlayer` приватен (как в tweb) — тест обращается к нему по имени, чтобы
// проверить РЕАЛЬНЫЙ обработчик 'error', а не его пересказ.
type LoaderInternals = {
  initPlayer(el: HTMLElement[], options: Record<string, unknown>): {
    addEventListener(name: string, cb: (...args: unknown[]) => void): void
    fail(error: unknown): void
    remove(): void
    loadPromise?: Promise<unknown>
  }
}

describe('lottieLoader — упавший плеер снимается с animationIntersector', () => {
  it('обработчик error зовёт removeAnimationByPlayer', () => {
    const container = document.createElement('div')
    document.body.append(container)

    const player = (lottieLoader as unknown as LoaderInternals).initPlayer([container], {
      container,
      width: 64,
      height: 64,
      name: 'test-animation',
      animationData: new Blob([]),
    })

    // загрузка нас не интересует — важен только путь ошибки
    player.loadPromise?.catch(() => {})

    animationIntersector.addAnimation({
      animation: player as never,
      group: 'chat',
      observeElement: container,
      type: 'lottie',
    })

    expect(animationIntersector.getAnimations(container)).toHaveLength(1)

    player.fail(new Error('boom'))

    expect(animationIntersector.getAnimations(container)).toHaveLength(0)
  })
})
