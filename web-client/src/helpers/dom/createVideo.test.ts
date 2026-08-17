// Порт tweb createVideo. Пиним три атрибута/эффекта, каждый из которых
// «невидим» до реального устройства:
//   • playsinline — без него iOS уводит автоплей гифки в системный полный экран;
//   • disablePictureInPicture по умолчанию, снимается только pip:true;
//   • onDestroy → src='' + load() — снятие бабла со скролла обязано отпустить
//     загрузку и декодер.
import { describe, expect, it, vi } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import createVideo from './createVideo'

describe('createVideo', () => {
  it('playsinline всегда, PiP запрещён по умолчанию и разрешён по pip:true', () => {
    expect(createVideo({}).getAttribute('playsinline')).toBe('true')
    expect(createVideo({}).disablePictureInPicture).toBe(true)
    // happy-dom этого свойства не реализует — нетронутое оно undefined, а не
    // false (в браузере false). Проверяем существенное: pip:true его НЕ ставит.
    expect(createVideo({ pip: true }).disablePictureInPicture).toBeFalsy()
  })

  it('смерть middleware отпускает загрузку: src сбрасывается и вызывается load()', async () => {
    const helper = getMiddleware()
    const video = createVideo({ middleware: helper.get() })
    const load = vi.fn()
    video.load = load
    video.src = 'blob:stream'

    helper.destroy()
    // уборка ждёт getHeavyAnimationPromise() — доводим микротаски
    await new Promise<void>((r) => { setTimeout(r, 0) })

    // getAttribute, а не .src: happy-dom (как и браузер) резолвит пустой .src
    // в адрес документа — атрибут показывает, что именно записали
    expect(video.getAttribute('src')).toBe('')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('без middleware работает (уборка — забота вызывающего)', () => {
    expect(() => createVideo({})).not.toThrow()
  })
})
