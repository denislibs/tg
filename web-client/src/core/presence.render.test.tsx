// ПОДПИСЬ ПРИСУТСТВИЯ ДОЕЗЖАЕТ ДО ЭКРАНА — и потому её сторожит общий пин на выдачу.
//
// Ревью вернуло в `core/presence.ts` символический ключ (`'Lately'` вместо
// «был(а) недавно») в ОБЕ ветки — «недавно» и «времени нет вовсе» — и весь прогон
// остался зелёным: пин `src/test/domKeyLeak.ts` смотрит на DOM, а этих двух веток не
// рендерил ни один тест. Пин не всевидящий, он МАССОВЫЙ: экран без компонентного теста
// он не видит по построению. Этот файл закрывает конкретно `presence.ts` — рендерит обе
// ветки на настоящем экране, где подпись и живёт.
//
// Экран взят самый дешёвый из тех, что печатают `userStatusLabel`: «Добавить
// участников» (`AddMembersScreen` → `PeerSelector` → `.row-subtitle`). Кандидаты
// приезжают из адресной книги (`managers.contacts.list`), поэтому ни диалогов, ни
// зеркала пиров заводить не нужно.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AddMembersScreen from '../components/group/AddMembersScreen'
import { ManagersProvider } from './hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import type { Managers } from '../client/bootstrap'
import type { UserStatus } from './peers/peer'

// Уточка пустого состояния — рантайм lottie-web, который в happy-dom валится на своём
// модульном инициализаторе (тот же приём, что в `PeerSelector.test.tsx`).
vi.mock('../components/LottieSticker', () => ({ default: () => null }))

const user = (id: number, name: string) => ({ _: 'user' as const, id, first_name: name })

const managers = {
  contacts: {
    list: vi.fn(async () => [
      { userId: 1, note: '', sharePhone: false, hasCustomPhoto: false, createdAt: '', user: user(1, 'Recently') },
      { userId: 2, note: '', sharePhone: false, hasCustomPhoto: false, createdAt: '', user: user(2, 'Never') },
    ]),
  },
  channels: { search: vi.fn(async () => ({ users: [] })) },
  media: { downloadMediaURL: vi.fn(async () => '') },
} as unknown as Managers

const presence: Record<number, UserStatus> = {
  // Ветка `userStatusRecently` (`presence.ts:41`).
  1: { _: 'userStatusRecently' },
  // Ветка «времени нет вовсе»: `userStatusOffline` с нулевым `was_online` уводит в
  // `lastSeenLabel(0)` (`presence.ts:18`).
  2: { _: 'userStatusOffline', was_online: 0 },
}

const renderScreen = async () => {
  await act(async () => {
    render(
      <ManagersProvider managers={managers}>
        <AddMembersScreen chatId={10} existingIds={[]} onClose={() => {}} onAdded={() => {}} />
      </ManagersProvider>,
    )
  })
}

describe('подпись присутствия на экране «Добавить участников»', () => {
  beforeEach(() => {
    useChatsStore.setState({ presence })
  })
  afterEach(() => {
    cleanup()
    useChatsStore.setState({ presence: {} })
  })

  // Обе ветки обязаны ПОПАСТЬ В DOM — иначе общий пин на выдачу их снова не увидит, а
  // проверка ниже зеленела бы на пустом экране.
  it('обе ветки без времени напечатаны текстом, а не ключом', async () => {
    await renderScreen()
    const subtitles = [...document.querySelectorAll('.row-subtitle')].map((n) => n.textContent)
    expect(subtitles).toEqual(['last seen recently', 'last seen recently'])
    expect(screen.getByText('Recently')).toBeTruthy()
  })

  // Язык подписи берётся из настроек, а не зашит: на русском те же две ветки дают
  // русский текст. Это и отличает «перевод на месте» от «ключа, доехавшего до DOM».
  it('на русском те же ветки печатают русский текст', async () => {
    useChatsStore.setState({ presence })
    const { useI18nStore } = await import('../i18n')
    const prev = useI18nStore.getState().lang
    act(() => { useI18nStore.setState({ lang: 'ru' }) })
    try {
      await renderScreen()
      const subtitles = [...document.querySelectorAll('.row-subtitle')].map((n) => n.textContent)
      expect(subtitles).toEqual(['был(а) недавно', 'был(а) недавно'])
    } finally {
      act(() => { useI18nStore.setState({ lang: prev }) })
    }
  })
})
