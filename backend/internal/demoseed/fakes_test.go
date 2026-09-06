package demoseed

import (
	"context"
	"errors"
	"sort"

	"github.com/messenger-denis/backend/internal/domain"
	usecasechat "github.com/messenger-denis/backend/internal/usecase/chat"
)

// fakeChat — интерактор чата в памяти. Повторяет не подпись методов, а их
// ИНВАРИАНТЫ: комментарий без привязанного обсуждения не проходит, тред
// комментария садится на зеркало поста, зеркало рождается вместе с постом.
// Иначе сид «проходил» бы тест, ошибаясь ровно там, где ошибиться и можно.
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
	// reactions — сообщение → сколько реакций поставлено.
	reactions  map[int64]int
	nextChatID int64
	nextMsgID  int64
	nextPollID int64
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
	text       string
	threadRoot int64
	// mirrorOf — id поста канала, зеркалом которого является это сообщение.
	mirrorOf int64
}

func newFakeChat() *fakeChat {
	return &fakeChat{
		chats:      map[int64]*fakeChatRec{},
		byUsername: map[string]int64{},
		msgs:       map[int64]*fakeMsg{},
		discussion: map[int64]int64{},
		mirrors:    map[int64]int64{},
		pins:       map[int64]int64{},
		reactions:  map[int64]int{},
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

func (f *fakeChat) insert(chatID, senderID int64, text string, threadRoot, mirrorOf int64) domain.Message {
	f.nextMsgID++
	m := &fakeMsg{id: f.nextMsgID, chatID: chatID, senderID: senderID, text: text, threadRoot: threadRoot, mirrorOf: mirrorOf}
	f.msgs[m.id] = m
	f.msgOrder = append(f.msgOrder, m.id)
	out := domain.Message{ID: m.id, ChatID: chatID, Seq: m.id, SenderID: senderID, Text: text}
	if threadRoot != 0 {
		root := threadRoot
		out.ThreadRootID = &root
	}
	return out
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
	m := f.insert(disc, post.SenderID, post.Text, 0, post.ID)
	f.mirrors[post.ID] = m.ID
}

func (f *fakeChat) ListDialogs(_ context.Context, userID int64) ([]domain.DialogRecord, error) {
	ids := make([]int64, 0, len(f.chats))
	for id, c := range f.chats {
		if c.members[userID] {
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

func (f *fakeChat) AddMember(_ context.Context, chatID, actorID, userID int64) error {
	c := f.chats[chatID]
	if c == nil || !c.members[actorID] {
		return errFake
	}
	c.members[userID] = true
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

func (f *fakeChat) PostToChannel(_ context.Context, channelID, actorID int64, text string, _ domain.MessageEntities, _ string) (domain.Message, error) {
	c := f.chats[channelID]
	if c == nil || c.typ != domain.ChatTypeChannel || c.creator != actorID {
		return domain.Message{}, errFake
	}
	m := f.insert(channelID, actorID, text, 0, 0)
	f.mirror(m)
	return m, nil
}

func (f *fakeChat) Send(_ context.Context, in usecasechat.SendInput) (domain.Message, error) {
	c := f.chats[in.ChatID]
	if c == nil || !c.members[in.SenderID] {
		return domain.Message{}, errFake
	}
	var root int64
	if in.ThreadRootID != nil {
		root = *in.ThreadRootID
	}
	m := f.insert(in.ChatID, in.SenderID, in.Text, root, 0)
	f.mirror(m)
	return m, nil
}

// PostComment повторяет путь комментария: без обсуждения — отказ, тред садится
// на зеркало поста, автор доподписывается на группу обсуждения.
func (f *fakeChat) PostComment(ctx context.Context, channelID, postID, userID int64, text, clientMsgID string) (domain.Message, error) {
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
		m := f.insert(disc, post.senderID, post.text, 0, postID)
		f.mirrors[postID] = m.ID
		root = m.ID
	}
	f.chats[disc].members[userID] = true
	return f.Send(ctx, usecasechat.SendInput{
		ChatID: disc, SenderID: userID, Type: "text", Text: text,
		ClientMsgID: clientMsgID, ThreadRootID: &root,
	})
}

func (f *fakeChat) SendPoll(_ context.Context, in usecasechat.SendPollInput) (domain.Message, error) {
	c := f.chats[in.ChatID]
	if c == nil || !c.members[in.SenderID] {
		return domain.Message{}, errFake
	}
	m := f.insert(in.ChatID, in.SenderID, in.Question, 0, 0)
	f.nextPollID++
	pollID := f.nextPollID
	m.PollID = &pollID
	return m, nil
}

func (f *fakeChat) VotePoll(_ context.Context, _, _ int64, _ []int) (domain.PollInfo, error) {
	return domain.PollInfo{}, nil
}

func (f *fakeChat) SetPin(_ context.Context, chatID, msgID, userID int64, pin bool) error {
	c := f.chats[chatID]
	if c == nil || !c.members[userID] {
		return errFake
	}
	if pin {
		f.pins[chatID] = msgID
	} else {
		delete(f.pins, chatID)
	}
	return nil
}

func (f *fakeChat) React(_ context.Context, chatID, messageID, userID int64, _ string, add bool) error {
	c := f.chats[chatID]
	if c == nil || !c.members[userID] || f.msgs[messageID] == nil {
		return errFake
	}
	if add {
		f.reactions[messageID]++
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
