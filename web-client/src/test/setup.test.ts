// Пин проводки сетапа: заглушка `lottie-web` действительно установлена на всю
// среду. Без неё сам импорт модуля падает под happy-dom (библиотека на своём
// модульном инициализаторе пишет в 2D-контекст, которого нет), поэтому удаление
// `setupFiles` из `vitest.config.ts` красит этот файл — импорт бросит
// `TypeError: Cannot set properties of null (setting 'fillStyle')`.
//
// Тест нужен именно потому, что вред от пропажи заглушки НЕ виден по падениям:
// ошибка прилетает незаловленным отклонением, тесты остаются зелёными, а прогон
// просто засоряется — и, как предупреждает vitest, может давать false positive.
import { describe, expect, it, vi } from 'vitest'
import lottie from 'lottie-web'

describe('сетап прогона', () => {
  it('lottie-web заглушён на всю среду', () => {
    expect(vi.isMockFunction(lottie.loadAnimation)).toBe(true)
  })

  it('заглушка отдаёт годный инстанс анимации — потребители зовут destroy в cleanup', () => {
    const anim = lottie.loadAnimation({} as Parameters<typeof lottie.loadAnimation>[0])
    expect(typeof anim.destroy).toBe('function')
    expect(() => anim.destroy()).not.toThrow()
  })
})
