// Порт tweb `src/helpers/useGlobalDocumentEvent.ts` (812502980) 1:1 — один
// слушатель документа на тип события, общий для всех подписчиков; снимается с
// последним. Документ — активного окна (`bindActiveWindowListener`), чтобы в
// Document PiP события шли с его документа.
import { onCleanup } from 'solid-js'
import { bindActiveWindowListener } from '@helpers/appWindow'

type PossibleEvent = DocumentEventMap[keyof DocumentEventMap]

type EventsMapValue = {
  callbacks: Array<(e: PossibleEvent) => void>
  listener: (e: PossibleEvent) => void
  dispose?: () => void
}

const eventsMap = new Map<keyof DocumentEventMap, EventsMapValue>()

export function registerGlobalDocumentEvent<Key extends keyof DocumentEventMap>(eventName: Key, callback: (e: DocumentEventMap[Key]) => void) {
  const value: EventsMapValue = eventsMap.get(eventName) || {
    callbacks: [],
    listener: (e) => {
      value.callbacks.forEach((clb) => clb(e))
    },
  }

  if(!eventsMap.has(eventName)) {
    eventsMap.set(eventName, value)
    value.dispose = bindActiveWindowListener((w) => w.document, eventName, value.listener)
  }

  value.callbacks.push(callback as (e: PossibleEvent) => void)

  return {
    cleanup: () => {
      value.callbacks = value.callbacks.filter((clb) => clb !== callback)
      if(value.callbacks.length) return

      eventsMap.delete(eventName)
      value.dispose?.()
    },
  }
}

export default function useGlobalDocumentEvent<Key extends keyof DocumentEventMap>(eventName: Key, callback: (e: DocumentEventMap[Key]) => void) {
  const { cleanup } = registerGlobalDocumentEvent(eventName, callback)

  onCleanup(cleanup)
}
