import { describe, expect, it } from 'vitest'

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
