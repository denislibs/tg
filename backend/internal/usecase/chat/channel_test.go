package chat

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// ---- fakes for the channel usecase ----

// fakeChannelRepo is an in-memory per-channel pts + updates log.
type fakeChannelRepo struct {
	mu      sync.Mutex
	pts     map[int64]int64
	updates map[int64][]domain.ChannelUpdate
}

func newFakeChannelRepo() *fakeChannelRepo {
	return &fakeChannelRepo{pts: map[int64]int64{}, updates: map[int64][]domain.ChannelUpdate{}}
}

func (r *fakeChannelRepo) AppendUpdate(_ context.Context, channelID int64, typ string, payload json.RawMessage) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pts[channelID]++
	p := r.pts[channelID]
	r.updates[channelID] = append(r.updates[channelID], domain.ChannelUpdate{
		Pts: p, PtsCount: 1, Type: typ, Payload: append([]byte(nil), payload...),
	})
	return p, nil
}

func (r *fakeChannelRepo) UpdatesSince(_ context.Context, channelID, sincePts int64, limit int) ([]domain.ChannelUpdate, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.ChannelUpdate
	for _, u := range r.updates[channelID] {
		if u.Pts > sincePts {
			out = append(out, u)
			if len(out) == limit {
				break
			}
		}
	}
	return out, nil
}

func (r *fakeChannelRepo) CurrentPts(_ context.Context, channelID int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.pts[channelID], nil
}

// fakeSearchRepo resolves usernames and returns canned cards.
type fakeSearchRepo struct {
	mu        sync.Mutex
	usernames map[string]int64
}

func newFakeSearchRepo() *fakeSearchRepo {
	return &fakeSearchRepo{usernames: map[string]int64{}}
}

func (r *fakeSearchRepo) SearchChats(_ context.Context, _ string, _ int) ([]domain.ChatRecord, error) {
	return nil, nil
}

func (r *fakeSearchRepo) SearchUsers(_ context.Context, _ string, _ int) ([]domain.UserReal, error) {
	return nil, nil
}

func (r *fakeSearchRepo) SimilarChannels(_ context.Context, _, _ int64, _ int) ([]domain.ChatRecord, int, error) {
	return nil, 0, nil
}

func (r *fakeSearchRepo) PublicChatByUsername(_ context.Context, username string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if id, ok := r.usernames[username]; ok {
		return id, nil
	}
	return 0, domain.ErrNotFound
}

// fakeChannelPublisher records how many times PublishToChannel was called.
type fakeChannelPublisher struct {
	mu     sync.Mutex
	count  int
	frames [][]byte
}

func (p *fakeChannelPublisher) PublishToChannel(_ context.Context, _ int64, frame []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.count++
	p.frames = append(p.frames, frame)
	return nil
}

// lastPayload — поле d последнего опубликованного кадра {t, d}.
func (p *fakeChannelPublisher) lastPayload(t *testing.T) map[string]any {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.frames) == 0 {
		t.Fatal("кадров не опубликовано")
	}
	var env struct {
		T string         `json:"t"`
		D map[string]any `json:"d"`
	}
	if err := json.Unmarshal(p.frames[len(p.frames)-1], &env); err != nil {
		t.Fatalf("разбор кадра: %v", err)
	}
	return env.D
}

// lastMessage — САМО СООБЩЕНИЕ последнего кадра: кадр несёт его конструктором
// под ключом `message`, как updateNewMessage у оригинала, а pts лежит рядом.
func (p *fakeChannelPublisher) lastMessage(t *testing.T) map[string]any {
	t.Helper()
	m, ok := p.lastPayload(t)["message"].(map[string]any)
	if !ok {
		t.Fatalf("в кадре нет сообщения: %+v", p.lastPayload(t))
	}
	return m
}

// groupMembershipChats adapts a fakeGroupRepo as a ChatRepo for IsMember checks
// (the ChatRepo methods the channel usecase needs).
//
// Приватные чаты здесь НЕ заглушка, и это важно: `CreatePrivate`, возвращавший
// `(0, nil)`, делал недостижимым весь путь «сообщение от сервисного аккаунта» —
// уведомление автору о решении по предложке уезжало в чат 0 и терялось. Из-за
// этого дефект «решение едет текстом, а не действием» не мог покраснеть ни в
// одном тесте. Чат заводится в ТОМ ЖЕ store, что и сообщения, иначе
// `fakeMsgs.NextSeq` его не найдёт.
type groupMembershipChats struct {
	fg *fakeGroupRepo
	s  *store
}

func (c groupMembershipChats) FindPrivate(_ context.Context, a, b int64) (int64, error) {
	if c.s == nil {
		return 0, domain.ErrNotFound
	}
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	for cid, typ := range c.s.chatType {
		if typ != "private" {
			continue
		}
		m := c.s.members[cid]
		if m[a] != nil && m[b] != nil {
			return cid, nil
		}
	}
	return 0, domain.ErrNotFound
}

func (c groupMembershipChats) CreatePrivate(_ context.Context, a, b int64) (int64, error) {
	if c.s == nil {
		return 0, nil
	}
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	c.s.nextChatID++
	cid := c.s.nextChatID
	c.s.chatType[cid] = "private"
	c.s.chatSeq[cid] = 0
	c.s.members[cid] = map[int64]*member{a: {}, b: {}}
	return cid, nil
}
func (c groupMembershipChats) CreateSecret(context.Context, int64, int64) (int64, error) {
	return 0, nil
}
func (c groupMembershipChats) FindSaved(context.Context, int64) (int64, error) {
	return 0, domain.ErrNotFound
}
func (c groupMembershipChats) CreateSaved(context.Context, int64) (int64, error) { return 0, nil }
func (c groupMembershipChats) MemberIDs(context.Context, int64) ([]int64, error) { return nil, nil }

// groupMembershipChatsFanout — groupMembershipChats с настоящим MemberIDs.
// Обычный стаб выше всегда отдаёт nil: часть тестов канала не заводит
// updates-фейк, и Send() гейтит AppendUpdateBulk по len(members) именно
// поэтому (см. комментарий в message.go). Этот вариант нужен только тестам,
// которым важен реальный per-member WS-фанаут (например, сверка
// thread_root_id в live-кадре комментария).
type groupMembershipChatsFanout struct{ groupMembershipChats }

func (c groupMembershipChatsFanout) MemberIDs(_ context.Context, chatID int64) ([]int64, error) {
	c.fg.mu.Lock()
	defer c.fg.mu.Unlock()
	ids := make([]int64, 0, len(c.fg.members[chatID]))
	for uid := range c.fg.members[chatID] {
		ids = append(ids, uid)
	}
	return ids, nil
}
func (c groupMembershipChats) IsMember(_ context.Context, chatID, userID int64) (bool, error) {
	c.fg.mu.Lock()
	_, ok := c.fg.members[chatID][userID]
	c.fg.mu.Unlock()
	if ok || c.s == nil {
		return ok, nil
	}
	// Приватные чаты живут в store (см. CreatePrivate выше), а не в группах.
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	return c.s.members[chatID][userID] != nil, nil
}
func (c groupMembershipChats) ListDialogs(context.Context, int64) ([]domain.DialogRecord, error) {
	return nil, nil
}
func (c groupMembershipChats) ChatPartners(context.Context, int64) ([]int64, error)     { return nil, nil }
func (c groupMembershipChats) SetAutoDelete(context.Context, int64, int) error          { return nil }
func (c groupMembershipChats) SetChatTheme(context.Context, int64, string, int64) error { return nil }
func (c groupMembershipChats) UserAutoDelete(context.Context, int64) (int, error)       { return 0, nil }
func (c groupMembershipChats) SetUserAutoDelete(context.Context, int64, int) error      { return nil }
func (c groupMembershipChats) IncUnread(context.Context, int64, int64) (int, error)     { return 0, nil }
func (c groupMembershipChats) IncUnreadBulk(context.Context, int64, []int64) (map[int64]int64, error) {
	return nil, nil
}
func (c groupMembershipChats) IncUnreadReactions(context.Context, int64, int64) (int, error) {
	return 0, nil
}
func (c groupMembershipChats) ClearUnreadReactions(context.Context, int64, int64) error { return nil }
func (c groupMembershipChats) CurrentReadSeq(context.Context, int64, int64) (int64, error) {
	return 0, nil
}
func (c groupMembershipChats) SetRead(context.Context, int64, int64, int64, int) error   { return nil }
func (c groupMembershipChats) AppendReadMark(context.Context, int64, int64, int64) error { return nil }
func (c groupMembershipChats) ReadAtForSeq(context.Context, int64, int64, int64) (time.Time, bool, error) {
	return time.Time{}, false, nil
}
func (c groupMembershipChats) LastReadAt(context.Context, int64, int64) (time.Time, bool, error) {
	return time.Time{}, false, nil
}
func (c groupMembershipChats) AddMention(context.Context, int64, int64, int64, int64) error {
	return nil
}
func (c groupMembershipChats) ClearMentions(context.Context, int64, int64, int64) (int, error) {
	return 0, nil
}
func (c groupMembershipChats) NextMention(context.Context, int64, int64, int64) (int64, error) {
	return 0, domain.ErrNotFound
}
func (c groupMembershipChats) MaxSeq(context.Context, int64) (int64, error)             { return 0, nil }
func (c groupMembershipChats) ClearedSeq(context.Context, int64, int64) (int64, error)  { return 0, nil }
func (c groupMembershipChats) SetClearedSeq(context.Context, int64, int64, int64) error { return nil }
func (c groupMembershipChats) ChatType(context.Context, int64) (string, error)          { return "channel", nil }
func (c groupMembershipChats) PinMessage(context.Context, int64, int64, int64) error    { return nil }
func (c groupMembershipChats) UnpinMessage(context.Context, int64, int64) error         { return nil }
func (c groupMembershipChats) ListPins(context.Context, int64) ([]domain.Message, error) {
	return nil, nil
}
func (c groupMembershipChats) Viewers(context.Context, int64, int64, int64) ([]int64, error) {
	return nil, nil
}

// newChannelTestInteractor wires the interactor with fake group/channel/search
// repos plus a recording channel publisher, sharing membership state so
// requireRight, IsMember and AddMember all observe the same chat.
func newChannelTestInteractor(t *testing.T) (*Interactor, *fakeGroupRepo, *fakeSearchRepo, *fakeChannelPublisher) {
	t.Helper()
	return newChannelTestInteractorMsgs(t, func(s *store) MessageRepo { return fakeMsgs{s} })
}

// newChannelTestInteractorMsgs — то же самое, что newChannelTestInteractor, но
// с MessageRepo, собранным по store самим вызывающим (нужно тестам, которым
// требуется обернуть fakeMsgs — например, сымитировать сбой Insert в гонке за
// создание зеркала).
func newChannelTestInteractorMsgs(t *testing.T, msgs func(*store) MessageRepo) (*Interactor, *fakeGroupRepo, *fakeSearchRepo, *fakeChannelPublisher) {
	t.Helper()
	s := newStore()
	fg := newFakeGroupRepo()
	fch := newFakeChannelRepo()
	fs := newFakeSearchRepo()
	fpub := &fakeChannelPublisher{}
	in := New(fakeTx{}, groupMembershipChats{fg, s}, msgs(s), nil, nil, fakeMedia{s}, fg, nil, fch, fs, nil)
	in.SetChannelPublisher(fpub)
	// Media-фикстура для тестов Send с медиа (TestSendToChannel_CreatesMirror):
	// mediaID=42 принадлежит пользователю 7 — стандартному создателю канала
	// во всех тестах этого пакета. 101/102 — элементы альбома в
	// TestAlbum_MirrorsAllElements_SingleThread (discussion_mirror_test.go).
	s.seedMedia(42, 7)
	s.seedMedia(101, 7)
	s.seedMedia(102, 7)
	// fakeMsgs.NextSeq requires the chat to exist in the store's chatType map;
	// register channels there as fg.CreateMultiMember creates them.
	fg.onCreate = func(id int64) {
		s.mu.Lock()
		s.chatType[id] = "channel"
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	// Зеркалим привязку группы обсуждения в общий store — MirrorByPost/
	// MirrorsByPosts (fakeMsgs) резолвят её оттуда, а не из fg.discussion.
	fg.onSetDiscussion = s.seedDiscussion
	return in, fg, fs, fpub
}

func TestCreateChannel_CreatorIsCreator(t *testing.T) {
	i, fg, _, _ := newChannelTestInteractor(t)
	id, err := i.CreateChannel(context.Background(), 7, "News", "", "news", true)
	if err != nil {
		t.Fatal(err)
	}
	m, _ := fg.GetMember(context.Background(), id, 7)
	if m.Role != domain.RoleCreator {
		t.Fatalf("role=%q", m.Role)
	}
}

func TestPostToChannel_RequiresPostRight_AndPublishes(t *testing.T) {
	i, fg, _, fpub := newChannelTestInteractor(t)
	id, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	_ = fg.AddMember(context.Background(), id, 8, domain.RoleSubscriber, 0)
	// subscriber cannot post
	if _, err := i.PostToChannel(context.Background(), id, 8, "hi", nil, ""); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("subscriber post = %v", err)
	}
	// creator posts → published once to the channel topic
	msg, err := i.PostToChannel(context.Background(), id, 7, "hello world", nil, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if msg.Seq == 0 {
		t.Fatal("no seq")
	}
	if fpub.count != 1 {
		t.Fatalf("publishes=%d, want 1", fpub.count)
	}
}

// client_msg_id обязан ехать в эхо поста канала — им отправитель матчит свой
// оптимистичный бабл. У канала (в отличие от личных чатов и групп) нет
// message_ack: пост уходит REST'ом, и эхо — ЕДИНСТВЕННЫЙ ключ связки. Без него
// бабл навсегда остаётся «отправляется», а эхо ложится вторым — визуально
// дубль одного сообщения (воспроизведено на стенде 2026-08-13).
func TestPostToChannel_EchoCarriesClientMsgID(t *testing.T) {
	i, _, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	id, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	if _, err := i.PostToChannel(ctx, id, 7, "hello", nil, "opt-7"); err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}

	// Ключ сопоставления эха называется random_id — клиентским параметром
	// оригинала, а не нашим client_msg_id.
	if got, _ := fpub.lastMessage(t)["random_id"].(string); got != "opt-7" {
		t.Fatalf("random_id живого кадра = %q, want opt-7", got)
	}
}

// difference-реплей отдаёт тот же снимок, что живой кадр (общий
// channelPostPayload): вкладка, поймавшая пост катч-апом, а не живым кадром,
// обязана схлопнуть свой бабл тем же ключом.
func TestChannelDifference_CarriesClientMsgID(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	id, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	if _, err := i.PostToChannel(ctx, id, 7, "hello", nil, "opt-8"); err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}

	ups, err := i.GetChannelDifference(ctx, id, 7, 0, 100)
	if err != nil || len(ups) == 0 {
		t.Fatalf("GetChannelDifference: %v, %d строк", err, len(ups))
	}
	var d map[string]any
	if err := json.Unmarshal(ups[len(ups)-1].Payload, &d); err != nil {
		t.Fatalf("разбор payload: %v", err)
	}
	msg, _ := d["message"].(map[string]any)
	if got, _ := msg["random_id"].(string); got != "opt-8" {
		t.Fatalf("random_id в difference = %q, want opt-8", got)
	}
}

// Пост без client_msg_id (не от отправляющей вкладки — например, из бота или
// планировщика) поля не несёт: у получателей матчить нечего, пустая строка
// только сбивала бы дедуп.
func TestPostToChannel_NoClientMsgID_NoField(t *testing.T) {
	i, _, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	id, _ := i.CreateChannel(ctx, 7, "News", "", "", true)

	if _, err := i.PostToChannel(ctx, id, 7, "hello", nil, ""); err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}

	if _, ok := fpub.lastMessage(t)["random_id"]; ok {
		t.Fatal("random_id присутствует в кадре, хотя его не присылали")
	}
}

// Форматирование поста канала: до этого entities терялись на всём пути (хендлер
// их не читал, usecase не принимал, Insert не писал, payload не отдавал), и
// пост приезжал подписчику голым текстом — без bold/text_link/mention/hashtag.
func TestPostToChannel_KeepsEntities(t *testing.T) {
	i, _, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	id, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	ents := domain.MessageEntities{domain.NewMessageEntityBold(0, 6)}

	msg, err := i.PostToChannel(ctx, id, 7, "Голова: Мария", ents, "e1")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}

	// 1. дошли до Insert и вернулись в сохранённом сообщении (иначе история —
	// та, что читается из БД, — приедет без разметки)
	if len(msg.Entities) != 1 || msg.Entities[0].Tag() != domain.EntityBold {
		t.Fatalf("Entities сохранённого сообщения = %+v, want один bold", msg.Entities)
	}

	// 2. уехали в живом кадре (иначе подписчик видит голый текст до перезагрузки)
	raw, ok := fpub.lastMessage(t)["entities"]
	if !ok {
		t.Fatal("в живом кадре нет entities — форматирование поста теряется")
	}
	got, _ := json.Marshal(raw)
	if !strings.Contains(string(got), `"messageEntityBold"`) {
		t.Fatalf("entities кадра = %s, want bold", got)
	}

	// 3. и в difference — реплей должен совпадать с живым кадром
	ups, err := i.GetChannelDifference(ctx, id, 7, 0, 100)
	if err != nil || len(ups) == 0 {
		t.Fatalf("GetChannelDifference: %v, %d строк", err, len(ups))
	}
	var d map[string]any
	if err := json.Unmarshal(ups[len(ups)-1].Payload, &d); err != nil {
		t.Fatalf("разбор payload: %v", err)
	}
	dmsg, _ := d["message"].(map[string]any)
	if _, ok := dmsg["entities"]; !ok {
		t.Fatal("в difference нет entities — реплей разойдётся с живым кадром")
	}
}

// Разметка не берётся у клиента на веру — тот же sanitizeEntities, что и на
// обычной отправке (message.go:132).
func TestPostToChannel_SanitizesEntities(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	ctx := context.Background()
	id, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	// text_link с javascript:-схемой — ровно то, что sanitizeEntities выбрасывает
	// (sanitize.go:75, safeLinkURL). Рядом валидный bold: он обязан уцелеть,
	// иначе тест прошёл бы и при «выкинули всё подряд».
	bad := domain.MessageEntities{
		domain.NewMessageEntityTextURL(0, 5, "javascript:alert(1)"),
		domain.NewMessageEntityBold(0, 5),
	}

	msg, err := i.PostToChannel(ctx, id, 7, "hello", bad, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}

	if len(msg.Entities) != 1 || msg.Entities[0].Tag() != domain.EntityBold {
		t.Fatalf("Entities = %+v, want только bold (javascript:-ссылка должна быть выброшена)", msg.Entities)
	}
}

func TestGetChannelDifference(t *testing.T) {
	i, _, _, _ := newChannelTestInteractor(t)
	id, _ := i.CreateChannel(context.Background(), 7, "News", "", "", true)
	_, _ = i.PostToChannel(context.Background(), id, 7, "a", nil, "")
	_, _ = i.PostToChannel(context.Background(), id, 7, "b", nil, "")
	ups, err := i.GetChannelDifference(context.Background(), id, 7, 1, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(ups) != 1 {
		t.Fatalf("diff since 1 = %d", len(ups))
	}
}

// SetSignatures on a channel must broadcast chat_update once over the channel
// envelope (O(1)) — NOT fan out one per-user log row per subscriber — and land as
// a typed row in the channel difference so subscribers catch it up on open.
func TestSetSignatures_ChannelBroadcastNoFanout(t *testing.T) {
	i, fg, _, fpub := newChannelTestInteractor(t)
	ctx := context.Background()
	id, _ := i.CreateChannel(ctx, 7, "News", "", "", true)
	// two subscribers — an N+1 fan-out would scale with this, a broadcast won't
	_ = fg.AddMember(ctx, id, 8, domain.RoleSubscriber, 0)
	_ = fg.AddMember(ctx, id, 9, domain.RoleSubscriber, 0)

	if err := i.SetSignatures(ctx, id, 7, true, false); err != nil {
		t.Fatalf("SetSignatures: %v", err)
	}
	// exactly one channel-broadcast regardless of subscriber count
	if fpub.count != 1 {
		t.Fatalf("channel publishes=%d, want 1 (no per-subscriber fan-out)", fpub.count)
	}
	// and one typed chat_update row in the channel difference feed
	ups, err := i.GetChannelDifference(ctx, id, 7, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(ups) != 1 || ups[0].Type != "chat_update" {
		t.Fatalf("difference=%+v, want 1 chat_update", ups)
	}
}

func TestJoinPublicChannel(t *testing.T) {
	i, fg, fs, _ := newChannelTestInteractor(t)
	id, _ := i.CreateChannel(context.Background(), 7, "News", "", "news", true)
	fs.usernames["news"] = id
	if err := i.JoinPublic(context.Background(), "news", 9); err != nil {
		t.Fatal(err)
	}
	if _, err := fg.GetMember(context.Background(), id, 9); err != nil {
		t.Fatal("joiner not subscriber")
	}
}
