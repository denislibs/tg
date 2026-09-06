package demoseed

import (
	"context"
	"errors"
	"io"
	"sort"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
	usecasemedia "github.com/messenger-denis/backend/internal/usecase/media"
)

// fakeMedia — медиа-usecase в памяти. Нужен затем, что без него сид уходит в
// ветку «медиа недоступно»: альбомы не отправляются вовсе, и весь альбомный
// путь (ключ идемпотентности кадра) тестом не исполняется.
type fakeMedia struct {
	nextID int64
	// uploads — сколько картинок заведено: заливка платная, и на повторном
	// прогоне её не должно быть ни одной.
	uploads int
}

func (m *fakeMedia) CreateUpload(_ context.Context, in usecasemedia.UploadInput) (domain.Media, string, error) {
	m.nextID++
	m.uploads++
	return domain.Media{ID: m.nextID, OwnerID: in.OwnerID, Mime: in.Mime, Size: in.Size}, "", nil
}

func (m *fakeMedia) PutContent(_ context.Context, _, _ int64, r io.Reader, _ int64) error {
	_, err := io.Copy(io.Discard, r)
	return err
}

// fakeChat — интерактор чата в памяти. Повторяет не подпись методов, а их
// ИНВАРИАНТЫ: комментарий без привязанного обсуждения не проходит, тред
// комментария садится на зеркало поста, зеркало рождается вместе с постом,
// отправка отсекает дубль по client_msg_id, а приглашение и закрепление кладут
// в ленту служебную пилюлю на КАЖДЫЙ вызов. Иначе сид «проходил» бы тест,
// ошибаясь ровно там, где ошибиться и можно.
type fakeChat struct {
	chats      map[int64]*fakeChatRec
	byUsername map[string]int64
	msgs       map[int64]*fakeMsg
	msgOrder   []int64
	// discussion — канал → группа обсуждения (chats.discussion_chat_id).
	discussion map[int64]int64
	// mirrors — пост канала → его зеркало в группе обсуждения (корень треда).
	mirrors map[int64]int64
	pins    map[int64]int64
	// reactions — сообщение → эмодзи+автор поставленных реакций.
	reactions map[int64]map[string]bool
	// reactCalls — сколько раз вообще звали React: повторный вызов с той же
	// реакцией бампит счётчик непрочитанных реакций автора, то есть no-op'ом
	// не является.
	reactCalls int
	// postCommentCalls — сколько раз сид ВООБЩЕ полез отправлять комментарий:
	// гвард комментария — экономия, дубль отсёк бы и Send, поэтому иначе его
	// снятие ничем не отличить.
	postCommentCalls int
	nextChatID       int64
	nextMsgID        int64
	nextPollID       int64
}

type fakeChatRec struct {
	id       int64
	typ      string
	title    string
	username string
	creator  int64
	members  map[int64]bool
}

type fakeMsg struct {
	id         int64
	chatID     int64
	senderID   int64
	typ        string
	text       string
	cmid       string
	threadRoot int64
	// mirrorOf — id поста канала, зеркалом которого является это сообщение.
	mirrorOf int64
	// service — служебная пилюля (добавление участника, закрепление).
	service bool
}

func newFakeChat() *fakeChat {
	return &fakeChat{
		chats:      map[int64]*fakeChatRec{},
		byUsername: map[string]int64{},
		msgs:       map[int64]*fakeMsg{},
		discussion: map[int64]int64{},
		mirrors:    map[int64]int64{},
		pins:       map[int64]int64{},
		reactions:  map[int64]map[string]bool{},
	}
}

var errFake = errors.New("fake chat: отказано")

func (f *fakeChat) createChat(typ, title, about, username string, creator int64) (int64, error) {
	_ = about
	if creator == 0 {
		return 0, errFake
	}
	if username != "" {
		if _, busy := f.byUsername[username]; busy {
			return 0, errFake
		}
	}
	f.nextChatID++
	id := f.nextChatID
	f.chats[id] = &fakeChatRec{
		id: id, typ: typ, title: title, username: username,
		creator: creator, members: map[int64]bool{creator: true},
	}
	if username != "" {
		f.byUsername[username] = id
	}
	return id, nil
}

func (f *fakeChat) insert(chatID, senderID int64, typ, text, cmid string, threadRoot, mirrorOf int64) domain.Message {
	f.nextMsgID++
	m := &fakeMsg{
		id: f.nextMsgID, chatID: chatID, senderID: senderID, typ: typ, text: text, cmid: cmid,
		threadRoot: threadRoot, mirrorOf: mirrorOf,
	}
	f.msgs[m.id] = m
	f.msgOrder = append(f.msgOrder, m.id)
	out := domain.Message{ID: m.id, ChatID: chatID, Seq: m.id, SenderID: senderID, Text: text}
	if threadRoot != 0 {
		root := threadRoot
		out.ThreadRootID = &root
	}
	return out
}

// service кладёт в ленту служебную пилюлю — то, что оставляет за собой
// AddMember и SetPin при каждом вызове.
func (f *fakeChat) service(chatID, senderID int64) {
	m := f.insert(chatID, senderID, "service", "", "", 0, 0)
	f.msgs[m.ID].service = true
}

// mirror повторяет mirrorChannelPost: зеркало поста появляется в группе
// обсуждения на вставке поста и только при уже привязанном обсуждении.
func (f *fakeChat) mirror(post domain.Message) {
	c := f.chats[post.ChatID]
	if c == nil || c.typ != domain.ChatTypeChannel {
		return
	}
	disc := f.discussion[post.ChatID]
	if disc == 0 || f.mirrors[post.ID] != 0 {
		return
	}
	m := f.insert(disc, post.SenderID, "text", post.Text, "", 0, post.ID)
	f.mirrors[post.ID] = m.ID
}

// ListDialogs повторяет предикат прода: служебные группы обсуждения канала из
// списка диалогов ИСКЛЮЧЕНЫ (chatsrepo: `c.id NOT IN (SELECT discussion_chat_id
// ...)`) — доступ к ним только через тред комментариев. Фейк, отдающий их
// наравне с остальными, разрешал бы сиду искать группу обсуждения по названию —
// в проде такой поиск не находит ничего никогда.
func (f *fakeChat) ListDialogs(_ context.Context, userID int64) ([]domain.DialogRecord, error) {
	hidden := map[int64]bool{}
	for _, disc := range f.discussion {
		hidden[disc] = true
	}
	ids := make([]int64, 0, len(f.chats))
	for id, c := range f.chats {
		if c.members[userID] && !hidden[id] {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	out := make([]domain.DialogRecord, 0, len(ids))
	for _, id := range ids {
		c := f.chats[id]
		out = append(out, domain.DialogRecord{ChatID: id, Type: c.typ, Title: c.title, Username: c.username})
	}
	return out, nil
}

func (f *fakeChat) ChatCard(_ context.Context, chatID, _ int64) (domain.ChatRecord, error) {
	c := f.chats[chatID]
	if c == nil {
		return domain.ChatRecord{}, domain.ErrNotFound
	}
	return domain.ChatRecord{
		ID: c.id, Type: c.typ, Title: c.title, Username: c.username,
		CreatorID: c.creator, DiscussionChatID: f.discussion[chatID],
	}, nil
}

// MessageByClientMsgID — тот же ключ, которым отсекает дубль Send, и та же
// проверка участия, что у интерактора: не участнику — domain.ErrNotFound.
func (f *fakeChat) MessageByClientMsgID(_ context.Context, chatID, senderID int64, clientMsgID string) (domain.Message, error) {
	c := f.chats[chatID]
	if c == nil || !c.members[senderID] {
		return domain.Message{}, domain.ErrNotFound
	}
	if m := f.byClientMsgID(chatID, senderID, clientMsgID); m != nil {
		return f.wire(m), nil
	}
	return domain.Message{}, domain.ErrNotFound
}

func (f *fakeChat) ListPins(_ context.Context, chatID, userID int64) ([]domain.Message, error) {
	c := f.chats[chatID]
	if c == nil || !c.members[userID] {
		return nil, errFake
	}
	pinned := f.pins[chatID]
	if pinned == 0 {
		return nil, nil
	}
	return []domain.Message{f.wire(f.msgs[pinned])}, nil
}

func (f *fakeChat) byClientMsgID(chatID, senderID int64, cmid string) *fakeMsg {
	if cmid == "" {
		return nil
	}
	for _, id := range f.msgOrder {
		m := f.msgs[id]
		if m.chatID == chatID && m.senderID == senderID && m.cmid == cmid {
			return m
		}
	}
	return nil
}

func (f *fakeChat) wire(m *fakeMsg) domain.Message {
	out := domain.Message{ID: m.id, ChatID: m.chatID, Seq: m.id, SenderID: m.senderID, Text: m.text}
	if m.threadRoot != 0 {
		root := m.threadRoot
		out.ThreadRootID = &root
	}
	return out
}

func (f *fakeChat) CreateChannel(_ context.Context, creatorID int64, title, about, username string, _ bool) (int64, error) {
	return f.createChat(domain.ChatTypeChannel, title, about, username, creatorID)
}

func (f *fakeChat) CreateGroup(_ context.Context, creatorID int64, title, about, username string, _ bool, memberIDs []int64) (int64, error) {
	id, err := f.createChat(domain.ChatTypeGroup, title, about, username, creatorID)
	if err != nil {
		return 0, err
	}
	for _, uid := range memberIDs {
		f.chats[id].members[uid] = true
	}
	return id, nil
}

func (f *fakeChat) JoinPublic(_ context.Context, username string, userID int64) error {
	id, ok := f.byUsername[username]
	if !ok {
		return errFake
	}
	f.chats[id].members[userID] = true
	return nil
}

// AddMember кладёт служебную пилюлю на каждый вызов — даже если участник в чате
// уже был (postGroupService зовётся безусловно).
func (f *fakeChat) AddMember(_ context.Context, chatID, actorID, userID int64) error {
	c := f.chats[chatID]
	if c == nil || !c.members[actorID] {
		return errFake
	}
	c.members[userID] = true
	f.service(chatID, actorID)
	return nil
}

// LinkDiscussion повторяет проверки одноимённого метода интерактора: канал —
// каналом, группа — обычной группой актора, и группа ещё никем не занята.
func (f *fakeChat) LinkDiscussion(_ context.Context, channelID, groupID, actorID int64) (int64, error) {
	ch, g := f.chats[channelID], f.chats[groupID]
	if ch == nil || g == nil {
		return 0, errFake
	}
	if ch.typ != domain.ChatTypeChannel || g.typ != domain.ChatTypeGroup {
		return 0, errFake
	}
	if ch.creator != actorID || g.creator != actorID {
		return 0, errFake
	}
	for _, linked := range f.discussion {
		if linked == groupID {
			return 0, errFake
		}
	}
	f.discussion[channelID] = groupID
	return groupID, nil
}

func (f *fakeChat) PostToChannel(ctx context.Context, channelID, actorID int64, text string, ents domain.MessageEntities, clientMsgID string) (domain.Message, error) {
	c := f.chats[channelID]
	if c == nil || c.typ != domain.ChatTypeChannel || c.creator != actorID {
		return domain.Message{}, errFake
	}
	// У интерактора это та же Send: пост канала — ветка обычной отправки.
	return f.Send(ctx, usecasechat.SendInput{
		ChatID: channelID, SenderID: actorID, Text: text, Entities: ents, ClientMsgID: clientMsgID,
	})
}

func (f *fakeChat) Send(_ context.Context, in usecasechat.SendInput) (domain.Message, error) {
	c := f.chats[in.ChatID]
	if c == nil || !c.members[in.SenderID] {
		return domain.Message{}, errFake
	}
	if m := f.byClientMsgID(in.ChatID, in.SenderID, in.ClientMsgID); m != nil {
		return f.wire(m), nil
	}
	var root int64
	if in.ThreadRootID != nil {
		root = *in.ThreadRootID
	}
	typ := in.Type
	if typ == "" {
		typ = "text"
	}
	m := f.insert(in.ChatID, in.SenderID, typ, in.Text, in.ClientMsgID, root, 0)
	f.mirror(m)
	return m, nil
}

// PostComment повторяет путь комментария: без обсуждения — отказ, тред садится
// на зеркало поста, автор доподписывается на группу обсуждения. Зеркала может
// не быть вовсе (пост опубликован до привязки обсуждения) — тогда его дозаводит
// сам комментарий, как lazyMirrorPost.
func (f *fakeChat) PostComment(ctx context.Context, channelID, postID, userID int64, text, clientMsgID string) (domain.Message, error) {
	f.postCommentCalls++
	disc := f.discussion[channelID]
	if disc == 0 {
		return domain.Message{}, domain.ErrNotFound
	}
	post := f.msgs[postID]
	if post == nil || post.chatID != channelID {
		return domain.Message{}, domain.ErrNotFound
	}
	root := f.mirrors[postID]
	if root == 0 {
		m := f.insert(disc, post.senderID, "text", post.text, "", 0, postID)
		f.mirrors[postID] = m.ID
		root = m.ID
	}
	f.chats[disc].members[userID] = true
	return f.Send(ctx, usecasechat.SendInput{
		ChatID: disc, SenderID: userID, Type: "text", Text: text,
		ClientMsgID: clientMsgID, ThreadRootID: &root,
	})
}

func (f *fakeChat) SendPoll(ctx context.Context, in usecasechat.SendPollInput) (domain.Message, error) {
	c := f.chats[in.ChatID]
	if c == nil || !c.members[in.SenderID] {
		return domain.Message{}, errFake
	}
	msg, err := f.Send(ctx, usecasechat.SendInput{
		ChatID: in.ChatID, SenderID: in.SenderID, Type: "poll",
		Text: in.Question, ClientMsgID: in.ClientMsgID,
	})
	if err != nil {
		return domain.Message{}, err
	}
	f.nextPollID++
	pollID := f.nextPollID
	msg.PollID = &pollID
	return msg, nil
}

func (f *fakeChat) VotePoll(_ context.Context, _, _ int64, _ []int) (domain.PollInfo, error) {
	return domain.PollInfo{}, nil
}

// SetPin кладёт служебную пилюлю на каждое ЗАКРЕПЛЕНИЕ (messageActionPinMessage),
// открепление проходит молча — как у интерактора.
func (f *fakeChat) SetPin(_ context.Context, chatID, msgID, userID int64, pin bool) error {
	c := f.chats[chatID]
	if c == nil || !c.members[userID] {
		return errFake
	}
	if pin {
		f.pins[chatID] = msgID
		f.service(chatID, userID)
	} else {
		delete(f.pins, chatID)
	}
	return nil
}

func (f *fakeChat) React(_ context.Context, chatID, messageID, userID int64, emoji string, add bool) error {
	c := f.chats[chatID]
	if c == nil || !c.members[userID] || f.msgs[messageID] == nil {
		return errFake
	}
	if add {
		f.reactCalls++
		set, ok := f.reactions[messageID]
		if !ok {
			set = map[string]bool{}
			f.reactions[messageID] = set
		}
		set[emoji] = true
	}
	return nil
}

// chatByTitle — чат демо-контента по названию (в спеках они уникальны).
func (f *fakeChat) chatByTitle(title string) *fakeChatRec {
	for _, c := range f.chats {
		if c.title == title {
			return c
		}
	}
	return nil
}

// mirrorOfPost — зеркало поста postID в группе обсуждения (0 — зеркала нет).
func (f *fakeChat) mirrorOfPost(postID int64) int64 {
	for _, id := range f.msgOrder {
		if m := f.msgs[id]; m.mirrorOf == postID {
			return m.id
		}
	}
	return 0
}

// commentsOn — комментарии треда поста postID в порядке отправки. Идём от
// ЗЕРКАЛА поста (mirrorOf), а не от карты f.mirrors: проверяется именно то,
// что комментарий сел на тред нужного поста.
func (f *fakeChat) commentsOn(postID int64) []*fakeMsg {
	root := f.mirrorOfPost(postID)
	if root == 0 {
		return nil
	}
	var out []*fakeMsg
	for _, id := range f.msgOrder {
		if m := f.msgs[id]; m.threadRoot == root {
			out = append(out, m)
		}
	}
	return out
}

// postByText — сообщение канала chatID с таким текстом.
func (f *fakeChat) postByText(chatID int64, text string) *fakeMsg {
	for _, id := range f.msgOrder {
		if m := f.msgs[id]; m.chatID == chatID && m.text == text {
			return m
		}
	}
	return nil
}

// pollMsgs — сообщения-опросы в порядке отправки.
func (f *fakeChat) pollMsgs() []*fakeMsg {
	var out []*fakeMsg
	for _, id := range f.msgOrder {
		if m := f.msgs[id]; m.typ == "poll" {
			out = append(out, m)
		}
	}
	return out
}

// dropPollKeys стирает у опросов ключ идемпотентности отправки — ровно так они
// лежат в базе живого стенда: ранние версии сида ClientMsgID опросам не
// проставляли, и «опроса нет» от «опрос уже стоит» по ключу не отличить.
func (f *fakeChat) dropPollKeys() int {
	n := 0
	for _, m := range f.pollMsgs() {
		m.cmid = ""
		n++
	}
	return n
}
