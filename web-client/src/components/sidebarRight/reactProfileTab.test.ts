// Вкладка №0 правой колонки (`reactProfileTab.ts`, ВРЕМЕННО до К-5): с К-3 панель
// профиля монтирует сама вкладка на `setPeer` (tweb `sharedMediaTab.tsx:68-83`),
// а не экран чата. Здесь — проводка: монтирование один раз, обновление тем же
// корнем, повтор того же пира — `false`, `destroy` снимает корень. Корень острова
// подменён: предмет — вкладка, а не `UserInfoPanel`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import type { Managers } from '@/client/bootstrap'
import { installSidebarRight } from '@/test/sidebarRight'
import type { ReactProfileTabViewProps } from './reactProfileTabView'

const renders: ReactProfileTabViewProps[] = []
let unmounts = 0

vi.mock('./reactProfileTabView', async() => {
  const { useEffect } = await import('react')
  return {
    default: (props: ReactProfileTabViewProps) => {
      renders.push(props)
      useEffect(() => () => { unmounts++ }, [])
      return createElement('span')
    },
  }
})

let sidebar: ReturnType<typeof installSidebarRight>

beforeEach(() => {
  renders.length = 0
  unmounts = 0
  sidebar = installSidebarRight({} as Managers)
})
afterEach(() => {
  sidebar.dispose()
})

describe('AppReactProfileTab.setPeer', () => {
  it('первый setPeer монтирует панель с пиром вкладки; fillProfileElements ждёт монтирования', async() => {
    const tab = sidebar.sidebar.createSharedMediaTab()
    expect(tab.setPeer(42)).toBe(true)
    await tab.fillProfileElements()

    expect(renders.at(-1)).toMatchObject({ tab, peerId: 42, threadId: undefined })
  })

  it('тот же пир — false и без перерисовки; другой — тот же корень с новым пиром', async() => {
    const tab = sidebar.sidebar.createSharedMediaTab()
    tab.setPeer(42)
    await tab.fillProfileElements()
    const count = renders.length
    const unmountsAfterMount = unmounts // StrictMode острова гоняет эффект дважды

    expect(tab.setPeer(42)).toBe(false)
    expect(renders).toHaveLength(count)

    expect(tab.setPeer(42, 7)).toBe(true)
    expect(renders.at(-1)).toMatchObject({ peerId: 42, threadId: 7 })
    expect(unmounts).toBe(unmountsAfterMount)
  })

  it('destroy снимает корень; destroy до загрузки модуля острова не монтирует его вовсе', async() => {
    const tab = sidebar.sidebar.createSharedMediaTab()
    tab.setPeer(42)
    await tab.fillProfileElements()
    const unmountsAfterMount = unmounts
    tab.destroy()
    expect(unmounts).toBe(unmountsAfterMount + 1)

    renders.length = 0
    const late = sidebar.sidebar.createSharedMediaTab()
    late.setPeer(1)
    late.destroy()
    await late.fillProfileElements()
    expect(renders).toHaveLength(0)
  })
})
