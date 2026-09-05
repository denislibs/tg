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

// Пин на находку раунда 1 ревью Этапа 0: заглушка `fetch` для
// `/assets/tgs/*` обязана сверяться с диском, а не отвечать 200 на любое
// имя, — иначе опечатка в имени встроенного lottie-ассета проходит молча
// при изолированном прогоне теста, который не мокает
// `@lib/lottie/lottieLoader` целиком.
describe('стаб fetch для /assets/tgs (Этап 0 «один движок lottie»)', () => {
  it('существующий ассет (Mailbox — реально лежит в public/assets/tgs/) резолвится json-заглушкой', async () => {
    const res = await fetch('/assets/tgs/Mailbox.json')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ v: '5.5.2' })
  })

  it('несуществующее имя — честный 404, а не молчаливый успех: .json() падает', async () => {
    const res = await fetch(`/assets/tgs/DefinitelyDoesNotExist_${Date.now()}.json`)
    expect(res.status).toBe(404)
    await expect(res.json()).rejects.toThrow()
  })
})
