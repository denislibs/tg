import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// toBeInTheDocument — jest-dom матчер; в проекте больше нигде не используется
// (остальные тесты обходятся toBeTruthy()/getByRole, который и так бросает при
// отсутствии узла), но код теста берём дословно из брифа — подключаем матчер
// локально в файле, не трогая общий vitest.config.ts/setupFiles.
import '@testing-library/jest-dom/vitest'
import StickerSetModal from './StickerSetModal'

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
    await waitFor(() => expect(screen.getByText('Duck')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /добавить 40 стикеров/i })).toBeInTheDocument()
  })

  it('рисует все стикеры набора', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    await waitFor(() => expect(screen.getAllByTestId('sticker')).toHaveLength(40))
  })

  it('добавляет набор по клику на кнопку', async () => {
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    const button = await screen.findByRole('button', { name: /добавить 40 стикеров/i })
    await userEvent.click(button)
    expect(install).toHaveBeenCalledWith(7)
  })

  it('у установленного набора кнопка удаляет набор', async () => {
    installed = [set]
    render(<StickerSetModal slug="utyaduck" onClose={() => {}} />)
    const button = await screen.findByRole('button', { name: /удалить стикеров/i })
    await userEvent.click(button)
    expect(uninstall).toHaveBeenCalledWith(7)
    expect(install).not.toHaveBeenCalled()
  })
})
