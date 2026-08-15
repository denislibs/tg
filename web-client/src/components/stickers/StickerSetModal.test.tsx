import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StickerSetModal from './StickerSetModal'
import animationIntersector from '../animationIntersector'

const set = { id: 7, slug: 'utyaduck', title: 'Duck', kind: 'sticker' as const, count: 40 }
const stickers = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1, setId: 7, mediaId: 100 + i, emoji: '🦆', position: i,
  width: 512, height: 512, mime: 'application/x-tgsticker',
}))

const install = vi.fn().mockResolvedValue(undefined)
const uninstall = vi.fn().mockResolvedValue(undefined)
let installed: typeof set[] = []

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="sticker" data-media={mediaId} />,
}))
vi.mock('../../core/hooks/useManagers', () => ({
  useManagers: () => ({
    stickers: {
      setBySlug: async () => ({ set, stickers }),
      mySets: async () => installed,
      install,
      uninstall,
    },
  }),
}))

describe('StickerSetModal', () => {
  // В проекте нет глобального автоклинапа testing-library — несколько
  // render() в одном файле без cleanup() оставляют предыдущие DOM-деревья и
  // ломают getByRole/getByText следующего теста.
  afterEach(cleanup)

  beforeEach(() => {
    installed = []
    install.mockClear()
    uninstall.mockClear()
  })

  it('показывает заголовок набора и кнопку с числом стикеров', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())
    expect(screen.getByRole('button', { name: /добавить 40 стикеров/i })).toBeTruthy()
  })

  it('рисует все стикеры набора', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    await waitFor(() => expect(screen.getAllByTestId('sticker')).toHaveLength(40))
  })

  it('добавляет набор по клику на кнопку', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    const button = await screen.findByRole('button', { name: /добавить 40 стикеров/i })
    fireEvent.click(button)
    expect(install).toHaveBeenCalledWith(7)
  })

  it('у установленного набора кнопка удаляет набор — с числом и падежом, как в tweb', async () => {
    installed = [set]
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    const button = await screen.findByRole('button', { name: /удалить 40 стикеров/i })
    fireEvent.click(button)
    expect(uninstall).toHaveBeenCalledWith(7)
    expect(install).not.toHaveBeenCalled()
  })

  it('клик по стикеру шлёт его через onPickSticker и закрывает попап (tweb onStickersClick)', async () => {
    const onPickSticker = vi.fn()
    const onClose = vi.fn()
    render(<StickerSetModal slug="utyaduck" onClose={onClose} onPickSticker={onPickSticker} />)
    await waitFor(() => expect(screen.getAllByTestId('sticker')).toHaveLength(40))
    // сетка кликабельна — без is-read-only, когда есть колбэк отправки
    expect(document.querySelector('.sticker-set-stickers')!.classList.contains('is-read-only')).toBe(false)
    fireEvent.click(document.querySelector('.sticker-set-sticker')!)
    expect(onPickSticker).toHaveBeenCalledTimes(1)
    expect(onPickSticker.mock.calls[0][0].mediaId).toBe(100)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('без onPickSticker сетка помечена is-read-only и клик по стикеру ничего не делает', async () => {
    const onClose = vi.fn()
    render(<StickerSetModal slug="utyaduck" onClose={onClose} />)
    await waitFor(() => expect(screen.getAllByTestId('sticker')).toHaveLength(40))
    expect(document.querySelector('.sticker-set-stickers')!.classList.contains('is-read-only')).toBe(true)
    fireEvent.click(document.querySelector('.sticker-set-sticker')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('пока попап открыт, играет только его группа animationIntersector; на закрытии — сброс', async () => {
    const spy = vi.spyOn(animationIntersector, 'setOnlyOnePlayableGroup')
    const { unmount } = render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Duck')).toBeTruthy())
    expect(spy).toHaveBeenCalledWith('STICKERS-POPUP')
    unmount()
    expect(spy).toHaveBeenLastCalledWith()
    spy.mockRestore()
  })
})
