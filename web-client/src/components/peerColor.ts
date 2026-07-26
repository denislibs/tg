// Deterministic per-name avatar/title color (tweb's peer color palette). Shared
// by ConversationView and the chat dialogs so they tint avatars identically.
export const PEER_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774']

export function peerColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PEER_COLORS[h % PEER_COLORS.length]
}
