// Общий сетап прогона.
//
// `lottie-web` невозможно вычислить под happy-dom: библиотека на СВОЁМ модульном
// инициализаторе создаёт канву и пишет в 2D-контекст, а happy-dom отдаёт на
// `getContext('2d')` → `null`. Получается `TypeError: Cannot set properties of
// null (setting 'fillStyle')` — незаловленное отклонение, которое не валит тест,
// но засоряет прогон и, как предупреждает сам vitest, «might cause false positive
// tests»: ошибка прилетает к случайному файлу, который в этот момент держит
// воркер, а не к тому, кто её породил. Отсюда и репутация «плавающей».
//
// Ловится это не импортом, а рантаймом: плеер грузится лениво
// (`components/lottie.ts::loadLottie`, ~521 kB отдельным чанком), и любой тест,
// который добирается до реального рендера анимации — уточки пустого состояния
// селектора, стикера, обезьянки пароля, — вычисляет модуль и падает. До сих пор
// с этим боролись поштучно: `PeerSelector.test.tsx` и `StickersHelper.suggest.
// test.ts` глушат каждый по-своему, и то же самое всплыло третьим файлом
// (`InputSearch.test.tsx` тянет `MemberPicker` → `PeerSelector` → уточка).
//
// Заглушка стоит на самом модуле, а не на канве: подменять `getContext` глобально
// значило бы менять поведение тестов, которые сознательно живут с `null`
// (`ChatBackground.test.tsx` — комментарий там прямо про это). Настоящего
// поведения `lottie-web` не проверяет ни один тест, поэтому терять здесь нечего.
import { vi } from 'vitest'

import { installDomKeyLeakPin } from './domKeyLeak'

vi.mock('lottie-web', () => {
  const anim = {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
    goToAndStop: vi.fn(),
    goToAndPlay: vi.fn(),
    setSpeed: vi.fn(),
    setDirection: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const lottie = {
    loadAnimation: vi.fn(() => anim),
    setQuality: vi.fn(),
    destroy: vi.fn(),
    registerAnimation: vi.fn(),
  }
  return { default: lottie, ...lottie }
})

// Пин на утечку ключа в DOM — общий для всех компонентных тестов (см. `domKeyLeak.ts`).
installDomKeyLeakPin()
