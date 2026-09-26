// Порт tweb `helpers/files/requestFile.ts` (812502980) — 1:1; правки только под
// формат `.oxlintrc.json` и strict (тип события `change`).
export default function requestFile(accept?: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.style.display = 'none'

  if(accept) {
    input.accept = accept
  }

  document.body.append(input)

  const promise = new Promise<File>((resolve, reject) => {
    input.addEventListener('change', (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if(!file) {
        reject('NO_FILE_SELECTED')
        return
      }

      resolve(file)
    }, { once: true })
  }).finally(() => {
    input.remove()
  })

  input.click()

  return promise
}
