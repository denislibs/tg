import type { Transport } from '../transport'

// PR-1b наполнит: Noise_NK-хендшейк + AEAD-кодек кадров (см. спеку подпроекта #1, §4).
// До тех пор DNP-путь — guarded-флаг: достижим только при AppConfig.dnp.enabled (дефолт OFF),
// поэтому прод не задет.
export function makeDnpTransport(): Transport {
  throw new Error('DNP transport not implemented yet (PR-1b)')
}
