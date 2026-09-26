// Порт tweb `helpers/dom/dispatchEvent.ts` (812502980) — 1:1. Первый вызывающий —
// сеттер `CheckboxField.checked` (tweb checkboxField.ts:155-162): программная
// запись поля обязана родить `change`, который всплывёт до формы (сохранение
// «Энергосбережения», `powerSaving.tsx:92`).
export const getSimulatedEvent = (name: string) => new Event(name, { bubbles: true, cancelable: true })

export default function simulateEvent(elem: EventTarget, name: string) {
  const event = getSimulatedEvent(name)
  elem.dispatchEvent(event)
}
