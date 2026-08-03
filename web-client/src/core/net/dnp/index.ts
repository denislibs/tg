import type { Transport } from '../transport'
import { DnpTransport } from './dnpTransport'
import { AppConfig } from '../../../config/app'

// Достижимо только при AppConfig.dnp.enabled (build-time VITE_DNP_ENABLED, дефолт OFF).
export function makeDnpTransport(): Transport {
  return new DnpTransport('/ws', AppConfig.dnp.serverStaticPublicKeys)
}
