import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { createManagers } from '../rpc/managersProxy'
import type { HealthStatus } from '../core/managers/healthManager'
import type { User } from '../core/managers/authManager'
import type { ProfileUpdate, SetUsernameResult } from '../core/managers/profileManager'
import type { Dialog, Draft } from '../core/models'
import type { Message, MessageEntity, Poll, Checklist, Scheduled, BoostStatus, Giveaway, SuggestedPost } from '../core/models'
import type { CreateGiveawayArgs } from '../core/managers/boostsManager'
import type { HistoryArgs, HistoryResult, SendArgs, ReactionUser, StarReactionInfo, StarReactionResult } from '../core/managers/messagesManager'
import type { ConnState, PresenceEvt, TypingAction } from '../core/realtime/events'
import type { UploadArgs, MediaMeta } from '../core/managers/mediaManager'
import type { SavedDialog } from '../core/managers/chatsManager'
import type { PushSub } from '../core/managers/pushManager'
import type { NotifySettings, NotifyPatch } from '../core/managers/notifyManager'
import type { Folder, FolderInput, FolderInvite, FolderInvitePreview } from '../core/managers/foldersManager'
import type { GroupCard } from '../core/managers/groupsManager'
import type { SearchResult, SuggestPostArgs } from '../core/managers/channelsManager'
import type { Peer } from '../core/managers/peersManager'
import type { StoryGroup, StoryStats } from '../core/managers/storiesManager'
import type { Contact, AddContactInput } from '../core/managers/contactsManager'
import type { PrivacyRule, BlockedUser, UserProfile } from '../core/managers/privacyManager'
import type { SignInOutcome, PasswordState, PasskeyInfo } from '../core/managers/authManager'
import type { Session } from '../core/managers/sessionsManager'
import type { IceConfig } from '../core/managers/callsManager'
import type { LivestreamStatus } from '../core/managers/livestreamManager'
import type { StarGift, GiftInfo } from '../core/managers/starsManager'
import type { ReportArgs } from '../core/managers/reportManager'
import type { ChannelStats, PostStats } from '../core/managers/statsManager'
import type { BotCommand, CallbackAnswer, InlineResult } from '../core/managers/botsManager'
import type { StickerSet, Sticker, SavedGif, GifPage } from '../core/managers/stickersManager'
import type { IVArticle } from '../core/managers/ivManager'

export interface Managers {
  health: { check(): Promise<HealthStatus> }
  auth: {
    requestCode(phone: string): Promise<void>
    signIn(phone: string, code: string, device: string, platform: string): Promise<SignInOutcome>
    checkPassword(passwordToken: string, password: string, device: string, platform: string): Promise<{ user: User }>
    passwordState(): Promise<PasswordState>
    setPassword(args: { currentPassword?: string; newPassword: string; hint: string; email: string }): Promise<void>
    removePassword(currentPassword: string): Promise<void>
    verifyPassword(password: string): Promise<void>
    passkeysList(): Promise<PasskeyInfo[]>
    passkeyRegisterBegin(): Promise<{ session: string; options: unknown }>
    passkeyRegisterFinish(session: string, attestation: unknown): Promise<PasskeyInfo>
    passkeyDelete(id: number): Promise<void>
    passkeyLoginBegin(): Promise<{ session: string; options: unknown }>
    passkeyLoginFinish(session: string, assertion: unknown, device: string, platform: string): Promise<{ user: User }>
    changePhone(newPhone: string): Promise<import('../core/managers/authManager').ChangePhoneResult>
    confirmChangePhone(newPhone: string, code: string): Promise<import('../core/managers/authManager').ConfirmChangePhoneResult>
    deleteAccount(): Promise<{ switched: boolean }>
    me(): Promise<User | null>
    logout(): Promise<{ switched: boolean }>
    listAccounts(): Promise<import('../core/auth/accounts').PublicAccount[]>
    switchAccount(id: number): Promise<boolean>
    addAccount(): Promise<void>
    qrNew(platform: string): Promise<{ token: string; url: string; expiresAt: string }>
    qrStatus(token: string): Promise<{ status: 'pending' | 'confirmed' | 'expired'; user?: User }>
    qrConfirm(token: string): Promise<void>
  }
  profile: {
    update(u: ProfileUpdate): Promise<User>
    checkUsername(username: string): Promise<{ available: boolean; reason?: string }>
    setUsername(username: string): Promise<SetUsernameResult>
    setAvatar(mediaId: number): Promise<User>
    setEmojiStatus(emoji: string): Promise<User>
    activatePremium(): Promise<User>
    addPhoto(mediaId: number, videoMediaId?: number): Promise<import('../core/managers/profileManager').ProfilePhoto>
    listPhotos(userId: number): Promise<import('../core/managers/profileManager').ProfilePhoto[]>
    deletePhoto(photoId: number): Promise<void>
  }
  premium: {
    checkout(
      plan: import('../core/premium/plans').PremiumPlanId,
      card: import('../core/premium/card').CardInput,
    ): Promise<{ user: User; subscription: import('../core/managers/premiumManager').PremiumSubscription }>
    getSubscription(): Promise<import('../core/managers/premiumManager').PremiumSubscription | null>
    cancelSubscription(): Promise<import('../core/managers/premiumManager').PremiumSubscription>
  }
  chats: {
    listDialogs(): Promise<Dialog[]>
    createPrivate(userId: number): Promise<number>
    saved(): Promise<number>
    savedDialogs(): Promise<SavedDialog[]>
    clearHistory(chatId: number): Promise<void>
    getReadDate(chatId: number, msgId: number): Promise<import('../core/managers/chatsManager').ReadDateResult>
  }
  messages: {
    getHistory(args: HistoryArgs): Promise<HistoryResult>
    sendMessage(args: SendArgs): Promise<Message>
    editMessage(chatId: number, msgId: number, text: string, entities?: MessageEntity[]): Promise<Message>
    deleteMessage(chatId: number, msgId: number, revoke: boolean): Promise<{ ok: boolean }>
    forwardMessages(toChatId: number, fromChatId: number, msgIds: number[]): Promise<Message[]>
    pin(chatId: number, msgId: number): Promise<{ ok: boolean }>
    unpin(chatId: number, msgId: number): Promise<{ ok: boolean }>
    setFactCheck(chatId: number, msgId: number, text: string, entities?: MessageEntity[], country?: string): Promise<Message>
    removeFactCheck(chatId: number, msgId: number): Promise<{ ok: boolean }>
    listPins(chatId: number): Promise<Message[]>
    viewers(chatId: number, msgId: number): Promise<number[]>
    reactionUsers(chatId: number, msgId: number): Promise<ReactionUser[]>
    searchMessages(chatId: number, q: string, offset?: number, limit?: number): Promise<{ messages: Message[]; count: number }>
    searchGlobal(q: string, filter?: '' | 'media' | 'files' | 'links' | 'music' | 'voice', offset?: number, limit?: number): Promise<{ messages: Message[]; count: number }>
    sendPoll(chatId: number, p: { question: string; options: string[]; anonymous: boolean; multiple: boolean; quiz: boolean; correctOption?: number; clientMsgId?: string }): Promise<Message>
    scheduleMessage(chatId: number, p: { text: string; entities?: MessageEntity[]; sendAt: number; replyToId?: number }): Promise<Scheduled>
    listScheduled(chatId: number): Promise<Scheduled[]>
    deleteScheduled(chatId: number, id: number): Promise<void>
    sendScheduledNow(chatId: number, id: number): Promise<Message>
    threadMessages(chatId: number, rootId: number, offset?: number, limit?: number): Promise<{ messages: Message[]; count: number }>
    groupCallParticipants(chatId: number): Promise<number[]>
    votePoll(pollId: number, options: number[]): Promise<Poll>
    closePoll(pollId: number): Promise<void>
    sendChecklist(chatId: number, c: { title: string; items: string[]; othersCanAdd: boolean; othersCanMark: boolean; clientMsgId?: string }): Promise<Message>
    toggleChecklistItem(checklistId: number, itemId: number): Promise<Checklist>
    addChecklistItems(checklistId: number, items: string[]): Promise<Checklist>
    mediaHistory(chatId: number, filter: 'media' | 'files' | 'links' | 'music' | 'voice', offset?: number, limit?: number): Promise<{ messages: Message[]; count: number }>
    getAround(chatId: number, centerSeq: number, limit?: number, threadRoot?: number): Promise<{ messages: Message[]; reachedTop: boolean; reachedBottom: boolean }>
    react(chatId: number, msgId: number, emoji: string): Promise<void>
    unreact(chatId: number, msgId: number, emoji: string): Promise<void>
    sendStarReaction(chatId: number, msgId: number, count: number, anonymous: boolean): Promise<StarReactionResult>
    getStarReaction(chatId: number, msgId: number): Promise<StarReactionInfo>
    translate(text: string, toLang: string): Promise<{ text: string; source: string }>
    sendGeoLive(chatId: number, lat: number, lng: number, livePeriod: number, heading?: number): Promise<Message>
    updateGeoLive(chatId: number, msgId: number, lat: number, lng: number, opts?: { heading?: number; stopped?: boolean }): Promise<Message>
  }
  realtime: {
    start(): Promise<{ state: ConnState }>
    sendMessage(args: { chatId: number; text: string; entities?: MessageEntity[] | null; clientMsgId: string; replyToId?: number | null; replyQuoteText?: string | null; replyQuoteOffset?: number | null; mediaId?: number | null; type?: string; groupedId?: string; geo?: { lat: number; lng: number; title?: string; address?: string; livePeriod?: number; heading?: number }; contactUserId?: number; threadRootId?: number | null; encBody?: string; ttlSeconds?: number | null; silent?: boolean; effect?: string | null; paidMediaPrice?: number | null }): Promise<{ ok: boolean }>
    markRead(args: { chatId: number; upToSeq: number }): Promise<{ ok: boolean }>
    markMediaRead(args: { chatId: number; msgId: number }): Promise<{ ok: boolean }>
    sendTyping(args: { chatId: number; action?: TypingAction }): Promise<{ ok: boolean }>
    sendCallFrame(args: { type: string; data: Record<string, unknown> }): Promise<{ ok: boolean }>
    subscribeChannel(args: { chatId: number }): Promise<{ ok: boolean }>
    unsubscribeChannel(args: { chatId: number }): Promise<{ ok: boolean }>
  }
  secret: {
    start(peerId: number): Promise<{ chatId: number }>
    accept(chatId: number): Promise<{ fingerprint: string[] }>
    reject(chatId: number): Promise<void>
    sync(chatId: number, meId: number): Promise<void>
    sendText(args: { chatId: number; text: string; entities?: unknown[]; ttlSeconds?: number | null; clientMsgId: string }): Promise<{ ok: boolean }>
    sendMedia(args: { chatId: number; bytes: ArrayBuffer; name: string; mime: string; size: number; mediaType: string; ttlSeconds?: number | null; clientMsgId: string }): Promise<{ ok: boolean }>
  }
  media: {
    upload(a: UploadArgs): Promise<number>
    cancelUpload(progressId: string): Promise<void>
    meta(id: number): Promise<MediaMeta>
    contentUrl(id: number): Promise<string>
    thumbUrl(id: number): Promise<string>
    tokenInfo(): Promise<{ token: string; expiresAt: number }>
  }
  push: {
    vapidKey(): Promise<string>
    subscribe(sub: PushSub): Promise<{ ok: boolean }>
  }
  notify: {
    settings(): Promise<NotifySettings>
    update(patch: NotifyPatch): Promise<NotifySettings>
  }
  folders: {
    list(): Promise<Folder[]>
    create(f: FolderInput): Promise<Folder>
    update(id: number, f: FolderInput): Promise<Folder>
    del(id: number): Promise<void>
    createInvite(folderId: number, title?: string): Promise<FolderInvite>
    listInvites(folderId: number): Promise<FolderInvite[]>
    revokeInvite(slug: string): Promise<void>
    previewInvite(slug: string): Promise<FolderInvitePreview>
    joinInvite(slug: string, chatIds: number[]): Promise<void>
  }
  groups: {
    createGroup(args: { title: string; about?: string; username?: string; isPublic?: boolean; memberIds?: number[] }): Promise<number>
    addMember(chatId: number, userId: number): Promise<void>
    setPhoto(chatId: number, mediaId: number): Promise<void>
    editInfo(chatId: number, args: { title: string; about?: string; username?: string }): Promise<void>
    setType(chatId: number, isPublic: boolean, username: string): Promise<void>
    setPermissions(chatId: number, permissions: number, slowmodeSeconds: number): Promise<void>
    setReactions(chatId: number, mode: 'all' | 'some' | 'none', emojis: string[]): Promise<void>
    setHistory(chatId: number, visible: boolean): Promise<void>
    setChargeStars(chatId: number, chargeStars: number): Promise<void>
    listBans(chatId: number): Promise<{ userId: number; bannedBy: number }[]>
    ban(chatId: number, userId: number): Promise<void>
    unban(chatId: number, userId: number): Promise<void>
    listRestrictions(chatId: number): Promise<{ userId: number; deniedRights: number; untilDate?: string; restrictedBy: number }[]>
    restrictMember(chatId: number, userId: number, deniedRights: number, untilSeconds?: number): Promise<void>
    unrestrictMember(chatId: number, userId: number): Promise<void>
    removeMember(chatId: number, userId: number): Promise<void>
    revokeInvite(chatId: number, token: string): Promise<void>
    deleteGroup(chatId: number): Promise<void>
    setMute(chatId: number, muted: boolean, until?: number): Promise<void>
    setNotify(chatId: number, patch: { preview?: boolean; sound?: 'default' | 'none' }): Promise<void>
    setPin(chatId: number, pinned: boolean): Promise<void>
    setArchive(chatId: number, archived: boolean): Promise<void>
    setForum(chatId: number, enabled: boolean): Promise<void>
    createTopic(chatId: number, title: string, iconColor: number, iconEmoji?: string): Promise<{ id: number; rootMsgId: number }>
    listTopics(chatId: number): Promise<import('../core/managers/groupsManager').TopicRow[]>
    closeTopic(chatId: number, topicId: number, closed: boolean): Promise<void>
    editTopic(chatId: number, topicId: number, title: string, iconColor: number, iconEmoji?: string): Promise<void>
    setTopicHidden(chatId: number, topicId: number, hidden: boolean): Promise<void>
    setTopicPinned(chatId: number, topicId: number, pinned: boolean): Promise<void>
    readTopic(chatId: number, rootMsgId: number, upToSeq: number): Promise<void>
    setTopicMuted(chatId: number, rootMsgId: number, muted: boolean): Promise<void>
    card(chatId: number): Promise<GroupCard>
    members(chatId: number): Promise<{ userId: number; role: string; online: boolean }[]>
    promoteAdmin(chatId: number, userId: number, rights: number): Promise<void>
    demoteAdmin(chatId: number, userId: number): Promise<void>
    createInvite(chatId: number, opts?: { usageLimit?: number; requiresApproval?: boolean; expireSeconds?: number }): Promise<{ token: string; url: string; requiresApproval: boolean; expiresAt?: string }>
    listInvites(chatId: number): Promise<{ token: string; uses: number; url: string; requiresApproval: boolean; expiresAt?: string }[]>
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
    similar(chatId: number): Promise<{ chats: SearchResult['chats']; count: number }>
    enableDiscussion(channelId: number): Promise<number>
    postComment(channelId: number, postId: number, text: string, clientMsgId: string): Promise<Message>
    listComments(channelId: number, postId: number, offset?: number, limit?: number): Promise<{ messages: Message[]; count: number }>
    commentCounts(channelId: number, postIds: number[]): Promise<Record<number, number>>
    viewCounts(channelId: number, postIds: number[]): Promise<Record<number, number>>
    suggestPost(chatId: number, args: SuggestPostArgs): Promise<SuggestedPost>
    listSuggestedPosts(chatId: number): Promise<SuggestedPost[]>
    approveSuggestedPost(id: number, publishAt?: number): Promise<SuggestedPost>
    rejectSuggestedPost(id: number): Promise<SuggestedPost>
  }
  peers: { getUsers(ids: number[]): Promise<Peer[]> }
  presence: { get(ids: number[]): Promise<PresenceEvt[]> }
  stories: {
    feed(): Promise<StoryGroup[]>
    post(args: { mediaId: number; caption?: string; privacy?: 'everyone' | 'contacts' | 'selected'; allowIds?: number[] }): Promise<number>
    view(id: number): Promise<void>
    viewers(id: number): Promise<{ id: number; displayName: string; avatarUrl: string }[]>
    stats(id: number): Promise<StoryStats>
    del(id: number): Promise<void>
  }
  contacts: {
    add(input: AddContactInput): Promise<Contact>
    list(): Promise<Contact[]>
    del(contactId: number): Promise<void>
    setPhoto(contactId: number, mediaId: number): Promise<{ url: string }>
    clearPhoto(contactId: number): Promise<void>
    suggestPhoto(contactId: number, mediaId: number): Promise<void>
    acceptPhotoSuggestion(msgId: number): Promise<void>
  }
  privacy: {
    rules(): Promise<PrivacyRule[]>
    setRule(rule: PrivacyRule): Promise<PrivacyRule>
    blocked(offset?: number, limit?: number): Promise<{ users: BlockedUser[]; total: number }>
    block(userId: number): Promise<void>
    unblock(userId: number): Promise<void>
    profile(userId: number): Promise<UserProfile>
    autoDelete(): Promise<number>
    setAutoDelete(period: number): Promise<void>
    setChatAutoDelete(chatId: number, period: number): Promise<void>
  }
  chatThemes: {
    setChatTheme(chatId: number, themeId: string): Promise<void>
  }
  drafts: {
    list(): Promise<Draft[]>
    save(chatId: number, text: string, replyToId?: number | null, entities?: MessageEntity[]): Promise<Draft | null>
    delete(chatId: number): Promise<void>
    clearAll(): Promise<void>
  }
  sessions: {
    list(): Promise<Session[]>
    terminate(id: number): Promise<void>
    terminateOthers(): Promise<number>
  }
  calls: {
    iceConfig(): Promise<IceConfig>
  }
  livestream: {
    status(chatId: number): Promise<LivestreamStatus>
    start(chatId: number): Promise<LivestreamStatus>
    stop(chatId: number): Promise<void>
    revokeKey(chatId: number): Promise<LivestreamStatus>
  }
  stars: {
    balance(): Promise<number>
    topUp(amount: number): Promise<number>
    catalog(): Promise<StarGift[]>
    send(toUserId: number, giftId: number, message: string, anonymous: boolean): Promise<{ balance: number }>
    profileGifts(userId: number): Promise<GiftInfo[]>
    convert(giftId: number): Promise<number>
    setHidden(giftId: number, hidden: boolean): Promise<void>
    unlockPaidMedia(msgId: number): Promise<{ message: Message; balance: number }>
  }
  boosts: {
    status(chatId: number): Promise<BoostStatus>
    boost(chatId: number): Promise<BoostStatus>
    createGiveaway(chatId: number, a: CreateGiveawayArgs): Promise<Message>
    participateGiveaway(id: number): Promise<Giveaway>
    getGiveaway(id: number): Promise<Giveaway>
  }
  report: {
    report(a: ReportArgs): Promise<void>
  }
  stats: {
    getChannelStats(chatId: number): Promise<ChannelStats>
    getPostStats(chatId: number, msgId: number): Promise<PostStats>
  }
  bots: {
    commands(botId: number): Promise<BotCommand[]>
    callback(botId: number, chatId: number, data: string, messageId?: number): Promise<CallbackAnswer>
    inline(botId: number, query: string): Promise<{ results: InlineResult[]; placeholder: string }>
    menuButton(botId: number): Promise<{ text: string; url: string }>
    start(botId: number, payload: string): Promise<{ chat_id: number }>
    sendWebAppData(botId: number, data: string, buttonText: string): Promise<void>
    cloudGet(botId: number, keys: string[]): Promise<Record<string, string>>
    cloudSet(botId: number, key: string, value: string): Promise<void>
    cloudRemove(botId: number, keys: string[]): Promise<void>
    cloudKeys(botId: number): Promise<string[]>
  }
  stickers: {
    mySets(): Promise<StickerSet[]>
    setBySlug(slug: string): Promise<{ set: StickerSet; stickers: Sticker[] }>
    searchSets(q: string): Promise<StickerSet[]>
    install(setId: number): Promise<void>
    uninstall(setId: number): Promise<void>
    recent(): Promise<Sticker[]>
    faved(): Promise<Sticker[]>
    fave(stickerId: number): Promise<void>
    unfave(stickerId: number): Promise<void>
    use(stickerId: number): Promise<void>
    searchByEmoji(emoji: string): Promise<Sticker[]>
    savedGifs(): Promise<SavedGif[]>
    saveGif(mediaId: number): Promise<void>
    deleteGif(mediaId: number): Promise<void>
    searchGifs(q: string, pos?: string): Promise<GifPage>
  }
  iv: {
    article(url: string): Promise<IVArticle>
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
