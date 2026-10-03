// Порт tweb `src/helpers/files/getFilesFromEvent.ts` (812502980) — 1:1.
// Типы `FileSystemEntry` (у tweb — `any`) сужены под strict; ветка
// `e.originalEvent` (jQuery) у tweb мёртвая — снята.

type ScanEntry = FileSystemEntry | DataTransferItem | File | null

export default async function getFilesFromEvent(e: ClipboardEvent | DragEvent, onlyTypes: true): Promise<string[]>
export default async function getFilesFromEvent(e: ClipboardEvent | DragEvent, onlyTypes?: false): Promise<File[]>
export default async function getFilesFromEvent(e: ClipboardEvent | DragEvent, onlyTypes = false): Promise<(File | string)[]> {
  const files: (File | string)[] = []

  const scanFiles = async(entry: ScanEntry, item: DataTransferItem) => {
    if(entry && 'isDirectory' in entry && entry.isDirectory) {
      const directoryReader = (entry as FileSystemDirectoryEntry).createReader()
      await new Promise<void>((resolve) => {
        directoryReader.readEntries(async(entries) => {
          for(const entry of entries) {
            await scanFiles(entry, item)
          }

          resolve()
        })
      })
    } else if(entry) {
      if(onlyTypes) {
        files.push((entry as DataTransferItem | File).type)
      } else {
        const itemFile = item.getAsFile() // * Safari can't handle entry.file with pasting
        const file = entry instanceof File ?
          entry :
          (
            entry instanceof DataTransferItem ?
              entry.getAsFile() :
              await new Promise<File | null>((resolve) => (entry as FileSystemFileEntry).file(resolve, () => resolve(itemFile)))
          )

        if(!file) return
        files.push(file)
      }
    }
  }

  if(e instanceof DragEvent && e.dataTransfer?.files && !e.dataTransfer.items) {
    for(let i = 0; i < e.dataTransfer.files.length; i++) {
      const file = e.dataTransfer.files[i]
      files.push(onlyTypes ? file.type : file)
    }
  } else {
    const items = ((e as DragEvent).dataTransfer || (e as ClipboardEvent).clipboardData)!.items

    const promises: Promise<void>[] = []
    for(let i = 0; i < items.length; ++i) {
      const item: DataTransferItem = items[i]
      if(item.kind === 'file') {
        const entry = (onlyTypes ? item : item.webkitGetAsEntry()) || item.getAsFile()
        promises.push(scanFiles(entry, item))
      }
    }

    await Promise.all(promises)
  }

  return files
}
