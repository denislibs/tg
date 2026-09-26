/** @jsxImportSource solid-js */
// Тесты порта tweb `components/emptySearchPlaceholder/index.tsx` (см. шапку файла рядом).
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmptySearchPlaceholder from './emptySearchPlaceholder.solid'
import styles from './emptySearchPlaceholder.module.scss'

const player = vi.hoisted(() => ({ playOrRestart: vi.fn(), remove: vi.fn() }))
const loadAnimationAsAsset = vi.hoisted(() => vi.fn())

vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset },
}))

afterEach(() => {
  document.body.replaceChildren()
  vi.clearAllMocks()
})

function mount(props: Parameters<InstanceType<typeof EmptySearchPlaceholder>['feedProps']>[0]) {
  loadAnimationAsAsset.mockResolvedValue(player)
  const el = new EmptySearchPlaceholder()
  el.feedProps(props)
  document.body.append(el)
  return el
}

describe('EmptySearchPlaceholder', () => {
  it('контейнер, утка UtyanSearch 156px и тексты «No results» (tweb :20-35)', () => {
    const el = mount({})

    expect(el.tagName).toBe('EMPTY-SEARCH-PLACEHOLDER')
    expect(el.classList.contains(styles.Container)).toBe(true)

    const lottie = el.querySelector<HTMLElement>(`:scope > .${styles.LottieAnimation}`)!
    expect(lottie).not.toBeNull()
    expect(lottie.style.getPropertyValue('--size')).toBe('156px')
    expect(loadAnimationAsAsset).toHaveBeenCalledWith(
      expect.objectContaining({ container: lottie, width: 156, height: 156 }),
      'UtyanSearch',
    )

    const noResults = el.querySelector(`:scope > .${styles.NoResults}`)!
    expect(noResults.querySelector(`.${styles.NoResultsTitle}`)?.textContent).toBe('No results')
    expect(noResults.querySelector(`.${styles.NoResultsSubtitle}`)?.textContent).toBe('Try a different search term')
  })

  it('без onAllChats кнопки нет', () => {
    const el = mount({})
    expect(el.querySelector('button')).toBeNull()
  })

  it('с onAllChats — button.btn.primary «Search in All Chats» с волной; клик зовёт колбэк (tweb :38-46)', () => {
    const onAllChats = vi.fn()
    const el = mount({ onAllChats })

    const button = el.querySelector<HTMLButtonElement>(`:scope > button.btn.primary.${styles.ActionButton}`)!
    expect(button).not.toBeNull()
    expect(button.textContent).toBe('Search in All Chats')
    // волна — `use:ripple` (tweb :39); класс `rp` директивы перетирает реактивный
    // `class` той же кнопки — у оригинала так же, поэтому `position`/`overflow`
    // для волны задаёт сам модуль (`.ActionButton`)
    expect(button.querySelector(':scope > .c-ripple')).not.toBeNull()

    button.click()
    expect(onAllChats).toHaveBeenCalledTimes(1)
  })

  it('клик по утке перезапускает анимацию (restartOnClick, tweb :28)', async() => {
    const el = mount({})
    el.querySelector<HTMLElement>(`.${styles.LottieAnimation}`)!.click()
    await vi.waitFor(() => expect(player.playOrRestart).toHaveBeenCalledTimes(1))
  })

  it('снятие из группы голым remove() гасит утку — плеер освобождается', async() => {
    const el = mount({})
    el.remove()
    await vi.waitFor(() => expect(player.remove).toHaveBeenCalledTimes(1))
    expect(el.childElementCount).toBe(0)
  })
})
