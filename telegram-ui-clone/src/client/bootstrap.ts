import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { createManagers } from '../rpc/managersProxy'
import type { HealthStatus } from '../core/managers/healthManager'
import type { User } from '../core/managers/authManager'
import type { ProfileUpdate, SetUsernameResult } from '../core/managers/profileManager'
import type { Dialog } from '../core/models'
import type { Message, MessageEntity } from '../core/models'
import type { HistoryArgs, HistoryResult, SendArgs } from '../core/managers/messagesManager'
import type { ConnState, PresenceEvt } from '../core/realtime/events'
import type { UploadArgs, MediaMeta } from '../core/managers/mediaManager'
import type { PushSub } from '../core/managers/pushManager'
import type { GroupCard } from '../core/managers/groupsManager'
import type { SearchResult } from '../core/managers/channelsManager'
import type { Peer } from '../core/managers/peersManager'
import type { StoryGroup } from '../core/managers/storiesManager'
import type { Contact, AddContactInput } from '../core/managers/contactsManager'
import type { Session } from '../core/managers/sessionsManager'
import type { IceConfig } from '../core/managers/callsManager'

export interface Managers {
  health: { check(): Promise<HealthStatus> }
  auth: {
    requestCode(phone: string): Promise<void>
    signIn(phone: string, code: string, device: string, platform: string): Promise<{ user: User }>
    me(): Promise<User | null>
    logout(): Promise<void>
    qrNew(platform: string): Promise<{ token: string; url: string; expiresAt: string }>
    qrStatus(token: string): Promise<{ status: 'pending' | 'confirmed' | 'expired'; user?: User }>
    qrConfirm(token: string): Promise<void>
  }
  profile: {
    update(u: ProfileUpdate): Promise<User>
    checkUsername(username: string): Promise<{ available: boolean; reason?: string }>
    setUsername(username: string): Promise<SetUsernameResult>
    setAvatar(mediaId: number): Promise<User>
  }
  chats: {
    listDialogs(): Promise<Dialog[]>
    createPrivate(userId: number): Promise<number>
    saved(): Promise<number>
  }
  messages: {
    getHistory(args: HistoryArgs): Promise<HistoryResult>
    sendMessage(args: SendArgs): Promise<Message>
    editMessage(chatId: number, msgId: number, text: string, entities?: MessageEntity[]): Promise<Message>
    deleteMessage(chatId: number, msgId: number, revoke: boolean): Promise<{ ok: boolean }>
    forwardMessages(toChatId: number, fromChatId: number, msgIds: number[]): Promise<Message[]>
    pin(chatId: number, msgId: number): Promise<{ ok: boolean }>
    unpin(chatId: number, msgId: number): Promise<{ ok: boolean }>
    listPins(chatId: number): Promise<Message[]>
    viewers(chatId: number, msgId: number): Promise<number[]>
    searchMessages(chatId: number, q: string, offset?: number, limit?: number): Promise<{ messages: Message[]; count: number }>
    mediaHistory(chatId: number, filter: 'media' | 'files' | 'links' | 'music' | 'voice', offset?: number, limit?: number): Promise<{ messages: Message[]; count: number }>
    getAround(chatId: number, centerSeq: number, limit?: number): Promise<{ messages: Message[]; reachedTop: boolean; reachedBottom: boolean }>
  }
  realtime: {
    start(): Promise<{ state: ConnState }>
    sendMessage(args: { chatId: number; text: string; entities?: MessageEntity[] | null; clientMsgId: string; replyToId?: number | null; mediaId?: number | null; type?: string }): Promise<{ ok: boolean }>
    markRead(args: { chatId: number; upToSeq: number }): Promise<{ ok: boolean }>
    sendTyping(args: { chatId: number; action?: 'typing' | 'voice' | 'video' }): Promise<{ ok: boolean }>
    sendCallFrame(args: { type: string; data: Record<string, unknown> }): Promise<{ ok: boolean }>
    subscribeChannel(args: { chatId: number }): Promise<{ ok: boolean }>
    unsubscribeChannel(args: { chatId: number }): Promise<{ ok: boolean }>
  }
  media: {
    upload(a: UploadArgs): Promise<number>
    meta(id: number): Promise<MediaMeta>
    contentUrl(id: number): Promise<string>
    thumbUrl(id: number): Promise<string>
    tokenInfo(): Promise<{ token: string; expiresAt: number }>
  }
  push: {
    vapidKey(): Promise<string>
    subscribe(sub: PushSub): Promise<{ ok: boolean }>
  }
  groups: {
    createGroup(args: { title: string; about?: string; username?: string; isPublic?: boolean }): Promise<number>
    addMember(chatId: number, userId: number): Promise<void>
    setMute(chatId: number, muted: boolean): Promise<void>
    card(chatId: number): Promise<GroupCard>
    members(chatId: number): Promise<{ userId: number; role: string; online: boolean }[]>
    promoteAdmin(chatId: number, userId: number, rights: number): Promise<void>
    demoteAdmin(chatId: number, userId: number): Promise<void>
    createInvite(chatId: number, opts?: { usageLimit?: number; requiresApproval?: boolean }): Promise<{ token: string; url: string; requiresApproval: boolean }>
    listInvites(chatId: number): Promise<{ token: string; uses: number; url: string; requiresApproval: boolean }[]>
    joinByToken(token: string): Promise<{ status: 'requested' | 'joined' }>
    listJoinRequests(chatId: number): Promise<number[]>
    approveRequest(chatId: number, userId: number): Promise<void>
    declineRequest(chatId: number, userId: number): Promise<void>
  }
  channels: {
    createChannel(args: { title: string; about?: string; username?: string; isPublic?: boolean }): Promise<number>
    post(chatId: number, text: string, clientMsgId: string): Promise<Message>
    getDifference(chatId: number): Promise<Message[]>
    setPts(chatId: number, pts: number): Promise<void>
    join(username: string): Promise<void>
    search(q: string): Promise<SearchResult>
    enableDiscussion(channelId: number): Promise<number>
    postComment(channelId: number, postId: number, text: string, clientMsgId: string): Promise<Message>
    listComments(channelId: number, postId: number, offset?: number, limit?: number): Promise<{ messages: Message[]; count: number }>
    commentCounts(channelId: number, postIds: number[]): Promise<Record<number, number>>
    viewCounts(channelId: number, postIds: number[]): Promise<Record<number, number>>
  }
  peers: { getUsers(ids: number[]): Promise<Peer[]> }
  presence: { get(ids: number[]): Promise<PresenceEvt[]> }
  stories: {
    feed(): Promise<StoryGroup[]>
    post(args: { mediaId: number; caption?: string; privacy?: 'everyone' | 'contacts' | 'selected'; allowIds?: number[] }): Promise<number>
    view(id: number): Promise<void>
    viewers(id: number): Promise<{ id: number; displayName: string; avatarUrl: string }[]>
    del(id: number): Promise<void>
  }
  contacts: {
    add(input: AddContactInput): Promise<Contact>
    list(): Promise<Contact[]>
    del(contactId: number): Promise<void>
  }
  sessions: {
    list(): Promise<Session[]>
    terminate(id: number): Promise<void>
    terminateOthers(): Promise<number>
  }
  calls: {
    iceConfig(): Promise<IceConfig>
  }
}

let cached: { smp: SuperMessagePort; managers: Managers } | null = null

export function startClient(): { smp: SuperMessagePort; managers: Managers } {
  if (cached) return cached
  let ep: Endpoint
  if (typeof SharedWorker !== 'undefined') {
    // The `new URL(...)` must be inline in the constructor call so Vite
    // recognizes and bundles the worker into its own chunk.
    const w = new SharedWorker(new URL('../core/worker.ts', import.meta.url), { type: 'module' })
    ep = w.port
  } else {
    ep = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' }) as unknown as Endpoint
  }
  const smp = new SuperMessagePort(ep)
  const managers = createManagers<Managers>(smp)
  cached = { smp, managers }
  return cached
}
