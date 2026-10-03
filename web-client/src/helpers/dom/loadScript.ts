// Порт tweb `src/helpers/dom/loadScript.ts` (812502980) — дословно. Потребитель —
// `pages/bootstrapIm.ts` (опус-рекордер, его расхождение 2).
export default function loadScript(url: string) {
  const script = document.createElement('script')
  const promise = new Promise<HTMLScriptElement>((resolve) => {
    script.onload = script.onerror = () => {
      resolve(script)
    }
  })
  script.src = url
  document.body.appendChild(script)
  return promise
}
