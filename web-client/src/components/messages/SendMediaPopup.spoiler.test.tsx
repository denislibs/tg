// Попап отправки медиа — пункт «Скрыть спойлером» (порт tweb
// popups/newMedia.ts:284-304 + `spoiler-toggle` :1427-1437).
//
// Пиним ровно то, ради чего пункт существует: признак ДОЕЗЖАЕТ до отправки
// пофайлово. Если он потеряется здесь, дальше по конвейеру (sendFile → кадр →
// бэк) прятать будет нечего, и «скрытое» медиа уйдёт открытым.
//
// Живой спойлер поверх превью (SpoilerCover → wrapMediaSpoiler → WebGL) в
// happy-dom не поднимется — мокаем этот враппер целиком: он проверен своим
// тестом (`components/wrappers/mediaSpoiler.test.ts`).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

vi.mock('@components/wrappers/mediaSpoiler', () => ({
  default: vi.fn(async () => document.createElement('div')),
}))

const { default: SendMediaPopup } = await import('./SendMediaPopup')

const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

/** Popup гасит себя exit-анимацией; onSend летит из onExitComplete. */
const flushExit = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500))
  })
}

afterEach(cleanup)

describe('SendMediaPopup — спойлер', () => {
  it('по умолчанию спойлера нет ни на одном файле', async () => {
    const onSend = vi.fn()
    render(<SendMediaPopup files={[photo('a.jpg')]} initialAsFile={false} onClose={vi.fn()} onSend={onSend} />)

    fireEvent.click(screen.getByPlaceholderText('Add a caption…'))
    fireEvent.keyDown(screen.getByPlaceholderText('Add a caption…'), { key: 'Enter' })
    await flushExit()

    expect(onSend).toHaveBeenCalledWith('', false, null, [false])
  })

  it('переключатель на превью помечает файл, и признак уезжает в onSend', async () => {
    const onSend = vi.fn()
    render(<SendMediaPopup files={[photo('a.jpg')]} initialAsFile={false} onClose={vi.fn()} onSend={onSend} />)

    const toggle = document.querySelector('.spoiler-toggle') as HTMLElement
    expect(toggle).toBeTruthy()
    expect(toggle.dataset.toggled).toBeUndefined()

    fireEvent.click(toggle)
    expect((document.querySelector('.spoiler-toggle') as HTMLElement).dataset.toggled).toBe('true')

    fireEvent.keyDown(screen.getByPlaceholderText('Add a caption…'), { key: 'Enter' })
    await flushExit()

    expect(onSend).toHaveBeenCalledWith('', false, null, [true])
  })

  it('«скрыть всё» из меню накрывает все файлы, «убрать все» — снимает', async () => {
    const onSend = vi.fn()
    render(
      <SendMediaPopup
        files={[photo('a.jpg'), photo('b.jpg')]}
        initialAsFile={false}
        onClose={vi.fn()}
        onSend={onSend}
      />,
    )

    // порядок кнопок в шапке: закрытие попапа, затем ⋮
    const openMenu = () => fireEvent.click(document.querySelectorAll('button')[1])

    openMenu()
    // при двух файлах доступен только «на все» вариант (tweb canToggleSpoilers)
    expect(screen.queryByText('Hide with spoiler')).toBeNull()
    fireEvent.click(screen.getByText('Hide all with spoilers'))

    expect(document.querySelectorAll('.spoiler-toggle[data-toggled="true"]')).toHaveLength(2)

    openMenu()
    fireEvent.click(screen.getByText('Remove all spoilers'))
    expect(document.querySelectorAll('.spoiler-toggle[data-toggled="true"]')).toHaveLength(0)

    fireEvent.keyDown(screen.getByPlaceholderText('Add a caption…'), { key: 'Enter' })
    await flushExit()
    expect(onSend).toHaveBeenCalledWith('', false, null, [false, false])
  })

  it('«как файл» — переключателя спойлера нет: прятать нечего', () => {
    render(<SendMediaPopup files={[photo('a.jpg')]} initialAsFile onClose={vi.fn()} onSend={vi.fn()} />)
    expect(document.querySelector('.spoiler-toggle')).toBeNull()
  })
})
