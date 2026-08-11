// commandThenReload — общая точка вкладок-инициаторов перехода между
// аккаунтами (MainMenu.switchTo/addAccount, AuthFlow.backToAccount,
// PasscodeLockScreen «выйти»). Ни у одного из четырёх вызывающих файлов
// тестов нет, а поведение у строки есть: без проглатывания отказа реджект
// уходит из async-обработчика наружу, `location.reload()` следующей строкой
// НЕ исполняется, и вкладка остаётся с уже уехавшей exit-анимацией (на экране
// пасскода — прямо на нём: туда кадр rt:logging_out не долетает, насос
// `smp.on` регистрируется в startRealtime(), а тот гейтится runWhenUnlocked).
// Поэтому поведение сведено сюда и пинится здесь, а вызывающие стали
// однострочниками без собственной логики.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { commandThenReload } from './accountTransition'

afterEach(() => { vi.restoreAllMocks() })

describe('commandThenReload', () => {
  it('успешная команда — перезагружает ПОСЛЕ её завершения, не раньше', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    let resolve!: (v: boolean) => void
    const command = new Promise<boolean>((r) => { resolve = r })

    const done = commandThenReload(command)
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled() // команда ещё не ответила

    resolve(true)
    await done

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('отказ команды — всё равно перезагружает и наружу не бросает', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})

    await expect(commandThenReload(Promise.reject(new Error('idb недоступна')))).resolves.toBeUndefined()

    expect(reload).toHaveBeenCalledTimes(1)
  })
})
