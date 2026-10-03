// Порт tweb `src/helpers/files/getFileMimeType.ts` (812502980) в объёме
// потребителя — `getFileMimeType` (блок K `lib/appImManager.ts`).
// `normalizeFileMimeType` приедет со своим потребителем (попап медиа, К-4).
import { EXTENSION_MIME_TYPE_MAP, MIME_TYPE_ALIASES } from '@environment/mimeTypeMap'

type FileWithMimeType = Blob | {
  mime_type?: string,
  file_name?: string
}

export default function getFileMimeType(file: FileWithMimeType): string {
  const rawMimeType = 'mime_type' in file ? file.mime_type : (file as Blob).type
  const mimeType = (rawMimeType || '').toLowerCase()
  const normalizedMimeType = MIME_TYPE_ALIASES[mimeType] || mimeType

  if(normalizedMimeType && normalizedMimeType !== 'application/octet-stream') {
    return normalizedMimeType
  }

  const fileName = 'name' in file ? (file as File).name : (file as { file_name?: string }).file_name
  const extension = fileName?.split('.').pop()?.toLowerCase()
  return (extension && EXTENSION_MIME_TYPE_MAP[extension]) || normalizedMimeType
}
