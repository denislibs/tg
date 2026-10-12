// Порт tweb `src/components/radioForm.ts` (812502980) — дословно: `<form>` из
// готовых строк с радио-инпутами; `onChange` получает `value` взведённого
// инпута. Первый потребитель — радиогруппы меню (`buttonMenu.ts`,
// `ButtonMenuSync({radioGroups})`, tweb `buttonMenu.ts:303-316`): «выше/ниже»
// и «крупнее/мельче» плашки превью ссылки (`chat/input.ts`).
export default function RadioForm(radios: { container: HTMLElement, input: HTMLInputElement }[], onChange: (value: string, event: Event) => void) {
  const form = document.createElement('form')

  radios.forEach((r) => {
    const { container, input } = r
    form.append(container)
    input.addEventListener('change', (e) => {
      if(input.checked) {
        onChange(input.value, e)
      }
    })
  })

  return form
}
