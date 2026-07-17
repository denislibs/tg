// WebAuthn в UI-потоке (navigator.credentials недоступен в SharedWorker):
// конвертация protocol-JSON go-webauthn (поля в base64url) в ArrayBuffer'ы
// браузерного API и обратно. Формат ответа — как protocol.ParseCredential*
// ResponseBody ожидает.

export const isWebAuthnSupported = (): boolean =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential

function b64urlToBuf(s: string): ArrayBuffer {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : ''
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface WireCredDescriptor { type: string; id: string; transports?: string[] }
interface WireCreationOptions {
  publicKey: {
    challenge: string
    rp: { id?: string; name: string }
    user: { id: string; name: string; displayName: string }
    pubKeyCredParams: { type: string; alg: number }[]
    timeout?: number
    excludeCredentials?: WireCredDescriptor[]
    authenticatorSelection?: AuthenticatorSelectionCriteria
    attestation?: string
  }
}
interface WireRequestOptions {
  publicKey: {
    challenge: string
    timeout?: number
    rpId?: string
    allowCredentials?: WireCredDescriptor[]
    userVerification?: string
  }
}

const mapDescriptors = (list?: WireCredDescriptor[]): PublicKeyCredentialDescriptor[] | undefined =>
  list?.map((c) => ({
    type: c.type as PublicKeyCredentialType,
    id: b64urlToBuf(c.id),
    transports: c.transports as AuthenticatorTransport[] | undefined,
  }))

// Регистрация: options (go-webauthn JSON) → attestation-ответ для finish.
export async function createPasskey(rawOptions: unknown): Promise<unknown> {
  const { publicKey } = rawOptions as WireCreationOptions
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: b64urlToBuf(publicKey.challenge),
      rp: publicKey.rp,
      user: {
        id: b64urlToBuf(publicKey.user.id),
        name: publicKey.user.name,
        displayName: publicKey.user.displayName,
      },
      pubKeyCredParams: publicKey.pubKeyCredParams as PublicKeyCredentialParameters[],
      timeout: publicKey.timeout,
      excludeCredentials: mapDescriptors(publicKey.excludeCredentials),
      authenticatorSelection: publicKey.authenticatorSelection,
      attestation: publicKey.attestation as AttestationConveyancePreference | undefined,
    },
  })) as PublicKeyCredential
  const resp = cred.response as AuthenticatorAttestationResponse
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      attestationObject: bufToB64url(resp.attestationObject),
      clientDataJSON: bufToB64url(resp.clientDataJSON),
    },
  }
}

// Вход: options → assertion-ответ для finish (userHandle обязателен для
// discoverable login).
export async function getPasskeyAssertion(rawOptions: unknown): Promise<unknown> {
  const { publicKey } = rawOptions as WireRequestOptions
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBuf(publicKey.challenge),
      timeout: publicKey.timeout,
      rpId: publicKey.rpId,
      allowCredentials: mapDescriptors(publicKey.allowCredentials),
      userVerification: publicKey.userVerification as UserVerificationRequirement | undefined,
    },
  })) as PublicKeyCredential
  const resp = cred.response as AuthenticatorAssertionResponse
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bufToB64url(resp.authenticatorData),
      clientDataJSON: bufToB64url(resp.clientDataJSON),
      signature: bufToB64url(resp.signature),
      userHandle: resp.userHandle ? bufToB64url(resp.userHandle) : null,
    },
  }
}
