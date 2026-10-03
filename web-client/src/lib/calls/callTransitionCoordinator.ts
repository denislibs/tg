// Порт tweb `src/lib/calls/callTransitionCoordinator.ts` (812502980, 51 строка).
//
// ОБЪЯВЛЕННОЕ РАСХОЖДЕНИЕ: без резерва перехода конференции
// (`groupCallsController.reserveConferenceTransition`) — конференц-звонков у нас нет
// (бэклог Б-46), поэтому `run` — та же сериализованная FIFO-очередь без брони.

export class CallTransitionCoordinator {
  private transitionQueue: Promise<void> = Promise.resolve()

  public run<T>(callback: () => Promise<T>): Promise<T> {
    const previous = this.transitionQueue
    const transition = (async() => {
      await previous
      return await callback()
    })()

    this.transitionQueue = transition.then(
      (): void => undefined,
      (): void => undefined,
    )
    return transition
  }
}

const callTransitionCoordinator = new CallTransitionCoordinator()
export default callTransitionCoordinator
