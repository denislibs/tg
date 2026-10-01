// Порт tweb `src/helpers/solid/createListenerSetter.ts` (812502980) — дословно: `ListenerSetter`,
// который снимает свои слушатели вместе с владельцем Solid. Потребитель — список контактов
// (`components/sidebarLeft/contactsList.solid.tsx`).
import ListenerSetter from '@helpers/listenerSetter'
import { onCleanup } from 'solid-js'

export default function createListenerSetter() {
  const listenerSetter = new ListenerSetter()
  onCleanup(() => listenerSetter.removeAll())
  return listenerSetter
}
