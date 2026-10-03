// Порт tweb `src/environment/documentPictureInPictureSupport.ts` (812502980) — 1:1.
//
// Document Picture-in-Picture lets an arbitrary DOM subtree (not just a <video>) live in an
// always-on-top OS window — https://developer.chrome.com/docs/web-platform/document-picture-in-picture.
// Chromium-only as of 2026; absent everywhere else, so the chat-PiP entry point is gated on this.
const DOCUMENT_PICTURE_IN_PICTURE_SUPPORTED = typeof window !== 'undefined' &&
  'documentPictureInPicture' in window &&
  typeof window.documentPictureInPicture?.requestWindow === 'function'

export default DOCUMENT_PICTURE_IN_PICTURE_SUPPORTED
