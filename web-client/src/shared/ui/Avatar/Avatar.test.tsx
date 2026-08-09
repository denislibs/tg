// Task 7 fix — покрываем 4 находки ревью (см. task-7-report.md): механика
// fade-in должна воспроизводить tweb avatarNew.tsx:549-604, а не буквальный
// снимок из плана («класс fade-in при монтировании»). Ревизия f59c800
// вешала `fade-in` в className сразу и снимала его по `animationend`; все
// тесты ниже написаны так, чтобы падать на f59c800 (см. отчёт — доказательство
// red-on-revert).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import Avatar from './Avatar'

function getPhotoImg() {
  return document.querySelector<HTMLImageElement>('img.avatar-photo')
}

afterEach(() => {
  cleanup()
  document.body.classList.remove('animation-level-0')
  vi.useRealTimers()
})

describe('Avatar: fade-in фотографии — механика tweb avatarNew.tsx', () => {
  it('находка 1: анимация не стартует раньше готовности картинки — до onLoad нет .fade-in, картинка скрыта', () => {
    render(<Avatar background="#000" src="/media/1/content" />)
    const img = getPhotoImg()
    expect(img).toBeTruthy()
    // f59c800: className="avatar-photo fade-in" ставился безусловно при монтировании —
    // этот expect ловит именно это (упал бы: fade-in уже есть до какой-либо загрузки).
    expect(img!.classList.contains('fade-in')).toBe(false)
    expect(img!.style.opacity).toBe('0')
  })

  it('готовность (onLoad) одновременно показывает картинку и включает fade-in', () => {
    render(<Avatar background="#000" src="/media/1/content" />)
    const img = getPhotoImg()!
    fireEvent.load(img)
    expect(img.classList.contains('fade-in')).toBe(true)
    expect(img.style.opacity).toBe('')
  })

  it('находка 2: кэшированное фото (img.complete && naturalWidth>0 сразу после монтирования) — без fade-in', () => {
    // Браузерный аналог tweb `cached = !(result instanceof Promise)`: байты уже
    // декодированы к моменту монтирования — эмулируем через naturalWidth, т.к.
    // happy-dom не грузит реальные картинки (complete у него константно true).
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth')
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 40 })
    try {
      render(<Avatar background="#000" src="/media/1/content" />)
      const img = getPhotoImg()!
      // f59c800 не гейтил cached вообще — fade-in ставился всегда, этот expect бы упал.
      expect(img.classList.contains('fade-in')).toBe(false)
      expect(img.style.opacity).toBe('')
    } finally {
      if (descriptor) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', descriptor)
    }
  })

  it('находка 3: animation-level-0 — onLoad не добавляет fade-in, картинка сразу видима', () => {
    document.body.classList.add('animation-level-0')
    render(<Avatar background="#000" src="/media/1/content" />)
    const img = getPhotoImg()!
    fireEvent.load(img)
    // f59c800 не проверял animation-level-0 — fade-in оказался бы включён, expect бы упал.
    expect(img.classList.contains('fade-in')).toBe(false)
    expect(img.style.opacity).toBe('')
  })

  it('fade-in снимается через FADE_IN_DURATION=200мс (tweb avatarNew.tsx:600 — setTimeout, не animationend)', () => {
    vi.useFakeTimers()
    render(<Avatar background="#000" src="/media/1/content" />)
    const img = getPhotoImg()!
    fireEvent.load(img)
    expect(img.classList.contains('fade-in')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(img.classList.contains('fade-in')).toBe(false)
  })

  it('находка 4: повторная смена src на том же инстансе Avatar снова даёт полный цикл fade-in', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Avatar background="#000" src="/media/1/content" />)
    let img = getPhotoImg()!
    fireEvent.load(img)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(img.classList.contains('fade-in')).toBe(false)

    rerender(<Avatar background="#000" src="/media/2/content" />)
    img = getPhotoImg()!
    // f59c800: className — статический литерал, classList.remove('fade-in') императивно
    // менял DOM в обход React → при смене только src React ничего не перезаписывал,
    // и повторная загрузка проходила БЕЗ fade-in. Здесь новый src обязан снова
    // скрыть картинку и сбросить fade-in до готовности.
    expect(img.classList.contains('fade-in')).toBe(false)
    expect(img.style.opacity).toBe('0')

    fireEvent.load(img)
    expect(img.classList.contains('fade-in')).toBe(true)
  })

  it('находка ревью (финальная зачистка): onError переводит фазу в явный error, а не оставляет вечный pending', () => {
    render(<Avatar background="#000" src="/media/1/content" />)
    const img = getPhotoImg()!
    expect(img.dataset.photoPhase).toBe('pending') // до события

    fireEvent.error(img)

    // Без onError-обработчика фаза осталась бы 'pending' навсегда — этот expect
    // ловит именно отсутствие перехода (без фикса упал бы: phase так и 'pending').
    // Визуально ничего не меняется (opacity: 0 и там, и там — под картинкой
    // градиентная подложка `.avatar`), но состояние теперь явное, а не совпадение.
    expect(img.dataset.photoPhase).toBe('error')
    expect(img.classList.contains('fade-in')).toBe(false)
    expect(img.style.opacity).toBe('0')
  })
})
