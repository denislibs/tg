package chat

import (
	"context"
	"encoding/json"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// Ф-2 «Каналы»: пост и действия в broadcast-канале доставляются журналом
// канала и топиком, без веера по личным журналам подписчиков, — а то, что у
// обычного чата делал веер (непрочитанное, пуш, черновик, превью), делается
// без записи на подписчика.

type fakeDialogsCache struct {
	mu          sync.Mutex
	invalidated []int64
}

func (c *fakeDialogsCache) Get(context.Context, int64) ([]domain.DialogRecord, bool) {
	return nil, false
}
func (c *fakeDialogsCache) Set(context.Context, int64, []domain.DialogRecord) {}
func (c *fakeDialogsCache) Invalidate(_ context.Context, ids ...int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.invalidated = append(c.invalidated, ids...)
}

type channelEnv struct {
	i      *Interactor
	s      *store
	fg     *fakeGroupRepo
	fch    *fakeChannelRepo
	chPub  *fakeChannelPublisher
	pub    *fakePublisher
	notif  *fakeNotifier
	cache  *fakeDialogsCache
	drafts *fakeDrafts
	ch     int64 // канал: владелец 7, подписчики 8 и 9
}

func newChannelEnv(t *testing.T, msgs ...func(*store) MessageRepo) channelEnv {
	t.Helper()
	s := newStore()
	fg := newFakeGroupRepo()
	fch := newFakeChannelRepo()
	var mr MessageRepo = fakeMsgs{s}
	if len(msgs) > 0 {
		mr = msgs[0](s)
	}
	i := New(fakeTx{}, groupMembershipChatsFanout{groupMembershipChats{fg, s}}, mr,
		fakeUpdates{s}, fakeReactions{s}, fakeMedia{s}, fg, nil, fch, newFakeSearchRepo(), nil)
	fg.onCreate = func(id int64, typ string) {
		s.mu.Lock()
		s.chatType[id] = typ
		s.chatSeq[id] = 0
		s.mu.Unlock()
	}
	fg.onSetDiscussion = s.seedDiscussion
	e := channelEnv{i: i, s: s, fg: fg, fch: fch, chPub: &fakeChannelPublisher{}, pub: &fakePublisher{},
		notif: &fakeNotifier{}, cache: &fakeDialogsCache{}, drafts: newFakeDrafts()}
	i.SetChannelPublisher(e.chPub)
	i.SetPublisher(e.pub)
	i.SetNotifier(e.notif)
	i.SetDialogsCache(e.cache)
	i.SetDrafts(e.drafts)
	ctx := context.Background()
	e.ch, _ = i.CreateChannel(ctx, 7, "News", "", "", true)
	_ = fg.AddMember(ctx, e.ch, 8, domain.RoleSubscriber, 0)
	_ = fg.AddMember(ctx, e.ch, 9, domain.RoleSubscriber, 0)
	return e
}

// userFrames — кадры пер-юзерного канала пользователя с типом t (тела d).
func (e channelEnv) userFrames(userID int64, typ string) []map[string]any {
	e.pub.mu.Lock()
	defer e.pub.mu.Unlock()
	var out []map[string]any
	for _, f := range e.pub.frames {
		if f.userID != userID {
			continue
		}
		var env struct {
			T string         `json:"t"`
			D map[string]any `json:"d"`
		}
		if json.Unmarshal(f.frame, &env) == nil && env.T == typ {
			out = append(out, env.D)
		}
	}
	return out
}

// userLog — типы записей личного журнала пользователя.
func (e channelEnv) userLog(userID int64) []string {
	e.s.mu.Lock()
	defer e.s.mu.Unlock()
	var out []string
	for _, u := range e.s.updates[userID] {
		out = append(out, u.Type)
	}
	return out
}

// channelLog — записи журнала канала (тип + тело).
func (e channelEnv) channelLog() []domain.ChannelUpdate {
	e.fch.mu.Lock()
	defer e.fch.mu.Unlock()
	return append([]domain.ChannelUpdate(nil), e.fch.updates[e.ch]...)
}

func (e channelEnv) topicTypes() []string {
	e.chPub.mu.Lock()
	defer e.chPub.mu.Unlock()
	var out []string
	for _, f := range e.chPub.frames {
		var env struct {
			T string `json:"t"`
		}
		_ = json.Unmarshal(f, &env)
		out = append(out, env.T)
	}
	return out
}

func bodyTag(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var d map[string]any
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatalf("тело записи: %v", err)
	}
	return d
}

// A3-06, A3-07, A1-03/A3-01 (снимок списка), A1-12: пост канала даёт пуш
// подписчикам одним батчем с названием канала, снимает черновик автора,
// сбрасывает снимок списка чатов всех подписчиков, а автору приходит своя
// копия кадра с pFlags.out — раньше топика и с тем же pts.
func TestChannelPost_FanOutWithoutPerSubscriberJournal(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	_, _ = e.drafts.Upsert(ctx, 7, domain.Draft{ChatID: e.ch, Text: "черновик поста"})

	msg, err := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "пост"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	e.i.bg.Wait()

	got := append([]int64(nil), e.notif.recipients...)
	slices.Sort(got)
	if !slices.Equal(got, []int64{8, 9}) {
		t.Fatalf("пуш подписчикам = %v, want [8 9] (без автора)", got)
	}
	if len(e.notif.titles) != 1 || e.notif.titles[0] != "News" {
		t.Fatalf("заголовок пуша = %v, want название канала", e.notif.titles)
	}
	if _, ok := e.drafts.m[[2]int64{e.ch, 7}]; ok {
		t.Fatal("черновик автора пережил публикацию поста")
	}
	for _, uid := range []int64{7, 8, 9} {
		if !slices.Contains(e.cache.invalidated, uid) {
			t.Fatalf("снимок списка чатов %d не сброшен: %v", uid, e.cache.invalidated)
		}
	}
	// Подписчикам — ни строки в личный журнал, ни личного кадра: только топик.
	for _, uid := range []int64{8, 9} {
		if log := e.userLog(uid); slices.Contains(log, "new_message") {
			t.Fatalf("пост лёг в личный журнал подписчика %d: %v", uid, log)
		}
	}
	if tt := e.topicTypes(); !slices.Equal(tt, []string{"new_message"}) {
		t.Fatalf("кадры топика = %v", tt)
	}
	own := e.userFrames(7, "new_message")
	if len(own) != 1 {
		t.Fatalf("своя копия поста автору: %d кадров", len(own))
	}
	m, _ := own[0]["message"].(map[string]any)
	flags, _ := m["pFlags"].(map[string]any)
	if flags["out"] != true {
		t.Fatalf("у автора пост без pFlags.out: %v", m["pFlags"])
	}
	if own[0]["pts"] != float64(1) || own[0]["_"] != domain.UpdateNewChannelMessageTag {
		t.Fatalf("копия автора: pts=%v _=%v, want канальный pts 1", own[0]["pts"], own[0]["_"])
	}
	_ = msg

	// silent — без пуша.
	before := len(e.notif.recipients)
	if _, err := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "тихо", Silent: true}); err != nil {
		t.Fatalf("Send silent: %v", err)
	}
	e.i.bg.Wait()
	if len(e.notif.recipients) != before {
		t.Fatal("silent-пост дал пуш")
	}
}

// Пересылка в канал — та же доставка поста: пуш подписчикам есть (раньше не
// было), черновик пересылка не снимает.
func TestForwardToChannel_DeliversLikePost(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	src, _ := e.i.CreateChannel(ctx, 7, "Src", "", "", true)
	post, err := e.i.PostToChannel(ctx, src, 7, "исходный", nil, "")
	if err != nil {
		t.Fatalf("PostToChannel: %v", err)
	}
	e.i.bg.Wait()
	e.notif.recipients = nil
	_, _ = e.drafts.Upsert(ctx, 7, domain.Draft{ChatID: e.ch, Text: "черновик"})
	if _, err := e.i.ForwardMessages(ctx, ForwardInput{
		FromChatID: src, ToChatID: e.ch, MsgIDs: []int64{post.ID}, SenderID: 7,
	}); err != nil {
		t.Fatalf("ForwardMessages: %v", err)
	}
	e.i.bg.Wait()
	got := append([]int64(nil), e.notif.recipients...)
	slices.Sort(got)
	if !slices.Equal(got, []int64{8, 9}) {
		t.Fatalf("пуш пересланного поста = %v, want [8 9]", got)
	}
	if _, ok := e.drafts.m[[2]int64{e.ch, 7}]; !ok {
		t.Fatal("пересылка сняла черновик")
	}
}

// A1-09/A2-03/A3-08: у поста канала строится превью ссылки, и карточка едет
// правкой поста журналом канала — её отдаёт и догон канала.
func TestChannelPost_LinkPreviewViaChannelJournal(t *testing.T) {
	e := newChannelEnv(t)
	e.i.SetLinkPreviewer(&fakePreviewer{wp: &domain.WebPagePreview{
		URL: "https://example.com/a", SiteName: "Example", Title: "Заголовок",
	}})
	ctx := context.Background()
	if _, err := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "смотри https://example.com/a"}); err != nil {
		t.Fatalf("Send: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for len(e.channelLog()) < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	log := e.channelLog()
	if len(log) != 2 || log[1].Type != "edit_message" {
		t.Fatalf("журнал канала = %+v, want пост + правка с превью", log)
	}
	d := bodyTag(t, log[1].Payload)
	if d["_"] != domain.UpdateEditChannelMessageTag {
		t.Fatalf("конструктор правки = %v", d["_"])
	}
	m, _ := d["message"].(map[string]any)
	media, _ := m["media"].(map[string]any)
	if media["_"] != domain.MessageMediaWebPageTag {
		t.Fatalf("у поста нет карточки превью: media=%v", m["media"])
	}
	for _, uid := range []int64{8, 9} {
		if slices.Contains(e.userLog(uid), "web_page_update") {
			t.Fatalf("превью поста легло в личный журнал %d", uid)
		}
	}
}

// A2-22/A3-31: прочтение канала — только читателю; чужого «прочитано»
// подписчики и автор не получают, и строк в их журналах нет.
func TestChannelMarkRead_OnlyReader(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	post, _ := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "пост"})
	if err := e.i.MarkRead(ctx, e.ch, 8, post.Seq); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if !slices.Contains(e.userLog(8), "read") || len(e.userFrames(8, "read")) != 1 {
		t.Fatal("читатель не получил своё прочтение")
	}
	for _, uid := range []int64{7, 9} {
		if slices.Contains(e.userLog(uid), "read") || len(e.userFrames(uid, "read")) != 0 {
			t.Fatalf("пользователь %d получил чужое прочтение канала", uid)
		}
	}
}

// A3-31: правка, удаление и закреп поста — одна запись журнала канала
// (канальные конструкторы схемы), без строк в журналах подписчиков.
func TestChannelEditDeletePin_ChannelJournal(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	post, _ := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "пост"})

	if _, err := e.i.EditMessage(ctx, e.ch, post.ID, 7, "правка", nil); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	if err := e.i.SetPin(ctx, e.ch, post.ID, 7, true); err != nil {
		t.Fatalf("SetPin: %v", err)
	}
	if err := e.i.DeleteMessage(ctx, e.ch, post.ID, 7, true); err != nil {
		t.Fatalf("DeleteMessage: %v", err)
	}

	want := map[string]string{
		"edit_message":   domain.UpdateEditChannelMessageTag,
		"pin_message":    domain.UpdatePinnedChannelMessagesTag,
		"delete_message": domain.UpdateDeleteChannelMessagesTag,
	}
	seen := map[string]bool{}
	for _, u := range e.channelLog() {
		tag, ok := want[u.Type]
		if !ok {
			continue
		}
		d := bodyTag(t, u.Payload)
		if d["_"] != tag {
			t.Fatalf("%s: конструктор %v, want %s", u.Type, d["_"], tag)
		}
		if u.Type != "edit_message" && d["channel_id"] != float64(e.ch) {
			t.Fatalf("%s: channel_id=%v", u.Type, d["channel_id"])
		}
		seen[u.Type] = true
	}
	for typ := range want {
		if !seen[typ] {
			t.Fatalf("%s не лёг в журнал канала: %+v", typ, e.channelLog())
		}
		for _, uid := range []int64{8, 9} {
			if slices.Contains(e.userLog(uid), typ) {
				t.Fatalf("%s лёг в личный журнал подписчика %d", typ, uid)
			}
		}
	}
	// Живые кадры — в топик, автору правки — своя копия с out.
	for typ := range want {
		if !slices.Contains(e.topicTypes(), typ) {
			t.Fatalf("%s не ушёл в топик: %v", typ, e.topicTypes())
		}
	}
	if len(e.userFrames(7, "edit_message")) != 1 {
		t.Fatal("автор не получил свою копию правки")
	}
}

// A3-31: реакция в канале — один кадр в топик, без журналов подписчиков.
func TestChannelReaction_TopicOnly(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	post, _ := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "пост"})
	if err := e.i.React(ctx, e.ch, post.ID, 8, "👍", true); err != nil {
		t.Fatalf("React: %v", err)
	}
	// Личный кадр — только поставившему (8): его выбор на других устройствах.
	for _, uid := range []int64{7, 9} {
		if slices.Contains(e.userLog(uid), "reaction") || len(e.userFrames(uid, "reaction")) != 0 {
			t.Fatalf("реакция в канале ушла личным веером пользователю %d", uid)
		}
	}
	if len(e.userFrames(8, "reaction")) != 1 {
		t.Fatal("поставивший не получил своего кадра реакции")
	}
	if !slices.Contains(e.topicTypes(), "reaction") {
		t.Fatalf("реакция не ушла в топик канала: %v", e.topicTypes())
	}
}

// A2-23: «печатает» в broadcast-канале не рассылается.
func TestChannelTyping_NotFannedOut(t *testing.T) {
	e := newChannelEnv(t)
	if err := e.i.Typing(context.Background(), e.ch, 7, domain.SendMessageActionByTag(domain.SendMessageTypingActionTag)); err != nil {
		t.Fatalf("Typing: %v", err)
	}
	for _, uid := range []int64{8, 9} {
		if n := e.pub.countFor(uid); n != 0 {
			t.Fatalf("typing канала дошёл подписчику %d (%d кадров)", uid, n)
		}
	}
}

// A2-02: добавленный в канал получает updateChannel (диалог и подписка
// сокетов на топик); в группу — нет (там доставка веером, ей и так хватает).
func TestAddMember_AnnouncesChannelJoin(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	if err := e.i.AddMember(ctx, e.ch, 7, 10); err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	got := e.userFrames(10, "channel")
	if len(got) != 1 || got[0]["_"] != domain.UpdateChannelTag || got[0]["channel_id"] != float64(e.ch) {
		t.Fatalf("вступившему в канал updateChannel = %v", got)
	}
	if !slices.Contains(e.userLog(10), "channel") {
		t.Fatal("updateChannel не лёг в журнал — офлайн-устройство его не догонит")
	}

	grp, _, err := e.i.CreateGroup(ctx, 7, "Group", "", "", false, nil)
	if err != nil {
		t.Fatalf("CreateGroup: %v", err)
	}
	if err := e.i.AddMember(ctx, grp, 7, 11); err != nil {
		t.Fatalf("AddMember group: %v", err)
	}
	if len(e.userFrames(11, "channel")) != 0 {
		t.Fatal("updateChannel ушёл вступившему в группу")
	}
}

// Топики нового соединения: только broadcast-каналы пользователя и только
// прошедшие тот же гейт, что CanSubscribeChannel (забаненный — нет).
func TestChannelSubscriptions_GatedBroadcastOnly(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	other, _ := e.i.CreateChannel(ctx, 7, "Other", "", "", false)
	_ = e.fg.AddMember(ctx, other, 8, domain.RoleSubscriber, 0)
	grp, _, _ := e.i.CreateGroup(ctx, 7, "Group", "", "", false, nil)
	_ = e.fg.AddMember(ctx, grp, 8, domain.RoleMember, 0)
	e.fg.mu.Lock()
	if e.fg.bans[other] == nil {
		e.fg.bans[other] = map[int64]bool{}
	}
	e.fg.bans[other][8] = true
	e.fg.mu.Unlock()

	got := e.i.ChannelSubscriptions(ctx, 8)
	if len(got) != 1 || got[0].ChatID != e.ch {
		t.Fatalf("топики = %v, want только канал %d", got, e.ch)
	}
}

// Ревью #407: создатель канала — первый участник, его сокеты подписываются на
// топик тем же updateChannel; иначе посты других админов не доходили до него.
func TestCreateChannel_AnnouncesToCreator(t *testing.T) {
	e := newChannelEnv(t)
	got := e.userFrames(7, "channel")
	if len(got) != 1 || got[0]["channel_id"] != float64(e.ch) {
		t.Fatalf("создателю updateChannel = %v", got)
	}
}

// blockingNotifier — пуш, который не отпускает до сигнала: им проверяется, что
// ответ на публикацию поста веера по подписчикам не ждёт.
type blockingNotifier struct {
	fakeNotifier
	release chan struct{}
}

func (n *blockingNotifier) NotifyChannelPost(ctx context.Context, chatID int64, recipients []int64, seq int64, title, text string, peer domain.PeerID) {
	<-n.release
	n.fakeNotifier.NotifyChannelPost(ctx, chatID, recipients, seq, title, text, peer)
}

// Ревью #407: пуш поста (список подписчиков, онлайн, мьют, очередь) шёл
// синхронно внутри Send — ответ админу и message_ack ждали веера по каналу.
func TestChannelPost_PushDoesNotBlockSend(t *testing.T) {
	e := newChannelEnv(t)
	n := &blockingNotifier{release: make(chan struct{})}
	e.i.SetNotifier(n)
	done := make(chan error, 1)
	go func() {
		_, err := e.i.Send(context.Background(), SendInput{ChatID: e.ch, SenderID: 7, Text: "пост"})
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Send: %v", err)
		}
	case <-time.After(2 * time.Second):
		close(n.release)
		t.Fatal("Send ждал пуша подписчикам")
	}
	close(n.release)
	e.i.bg.Wait()
	if len(n.recipients) != 2 || n.titles[0] != "News" {
		t.Fatalf("пуш после ответа: %v %v", n.recipients, n.titles)
	}
}

// A1-12 / ревью #407: догон канала отдаёт автору его посты с pFlags.out
// (живьём у него своя копия с out; запись журнала одна на всех и out не несёт).
func TestChannelDifference_OwnPostsOut(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	if _, err := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "мой пост"}); err != nil {
		t.Fatal(err)
	}
	outOf := func(viewer int64) bool {
		ups, err := channelJournal(ctx, e.i, e.ch, viewer, 0)
		if err != nil || len(ups) == 0 {
			t.Fatalf("difference: %v %d", err, len(ups))
		}
		d := bodyTag(t, ups[0].Payload)
		m, _ := d["message"].(map[string]any)
		flags, _ := m["pFlags"].(map[string]any)
		return flags["out"] == true
	}
	if !outOf(7) {
		t.Fatal("автору догон отдал свой пост без out")
	}
	if outOf(8) {
		t.Fatal("подписчику догон отдал чужой пост с out")
	}
}

// expiringMsgs — fakeMsgs, у которого истёк автоудалением заданный пост.
type expiringMsgs struct {
	fakeMsgs
	expired *[]domain.Message
}

func (r expiringMsgs) ExpiredMessages(context.Context, int) ([]domain.Message, error) {
	out := *r.expired
	*r.expired = nil
	return out, nil
}

// Ревью #407 (A3-31): правка ботом, автоудаление и ⭐-реакции в канале —
// журналом канала и топиком, без строк в журналах подписчиков.
func TestChannelBotEditAutodeleteStars_NoPerSubscriberFanout(t *testing.T) {
	var expired []domain.Message
	e := newChannelEnv(t, func(s *store) MessageRepo { return expiringMsgs{fakeMsgs{s}, &expired} })
	ctx := context.Background()
	e.i.SetStars(newFakeStars())
	e.i.SetStarReactions(newFakeStarReactions())
	_ = e.fg.AddMember(ctx, e.ch, 50, domain.RoleAdmin, domain.AllRights)
	post, err := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 50, Text: "пост бота"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if _, err := e.i.BotEditMessageText(ctx, domain.BotAccount{BotID: 50}, e.ch, post.ID, "правка бота", nil, nil, false); err != nil {
		t.Fatalf("BotEditMessageText: %v", err)
	}
	if _, err := e.i.TopUpStars(ctx, 8, 50); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := e.i.SendStarReaction(ctx, e.ch, post.ID, 8, 5, false); err != nil {
		t.Fatalf("SendStarReaction: %v", err)
	}
	expired = []domain.Message{post}
	if n, err := e.i.PurgeExpiredMessages(ctx); err != nil || n != 1 {
		t.Fatalf("PurgeExpiredMessages = %d %v", n, err)
	}
	types := map[string]bool{}
	for _, u := range e.channelLog() {
		types[u.Type] = true
	}
	if !types["edit_message"] || !types["delete_message"] {
		t.Fatalf("журнал канала = %v, want правку и удаление", types)
	}
	for _, uid := range []int64{9} {
		for _, typ := range []string{"edit_message", "delete_message", "reaction"} {
			if slices.Contains(e.userLog(uid), typ) {
				t.Fatalf("%s лёг в личный журнал подписчика %d", typ, uid)
			}
		}
	}
	if !slices.Contains(e.topicTypes(), "reaction") {
		t.Fatalf("⭐-реакция не ушла в топик: %v", e.topicTypes())
	}
}

// Ревью #407 (№12): отправка отложенного поста по расписанию не снимает
// черновик, который автор набирает сейчас (у оригинала черновик снимает само
// планирование — clear_draft в scheduleMessage).
func TestScheduledChannelPost_KeepsDraft(t *testing.T) {
	e := newChannelEnv(t)
	ctx := context.Background()
	e.i.SetScheduled(newFakeScheduled())
	sm, err := e.i.Send(ctx, SendInput{ChatID: e.ch, SenderID: 7, Text: "по расписанию", ScheduleDate: time.Now().Add(time.Hour).Unix()})
	if err != nil {
		t.Fatalf("постановка поста: %v", err)
	}
	_, _ = e.drafts.Upsert(ctx, 7, domain.Draft{ChatID: e.ch, Text: "набираю новый"})
	if _, err := e.i.SendScheduledNow(ctx, e.ch, 7, []int64{sm.Seq}); err != nil {
		t.Fatalf("публикация: %v", err)
	}
	if _, ok := e.drafts.m[[2]int64{e.ch, 7}]; !ok {
		t.Fatal("отложенный пост снял текущий черновик автора")
	}
}

// Слияние с Ф-4: пост канала, как и любое сообщение, возвращает незаглушённый
// канал подписчика из архива (keep_archived_unmuted).
func TestChannelPost_UnarchivesSubscriber(t *testing.T) {
	e := newChannelEnv(t)
	e.fg.mu.Lock()
	if e.fg.archived == nil {
		e.fg.archived = map[int64]map[int64]bool{}
	}
	if e.fg.archived[8] == nil {
		e.fg.archived[8] = map[int64]bool{}
	}
	e.fg.archived[8][e.ch] = true
	e.fg.mu.Unlock()
	if _, err := e.i.Send(context.Background(), SendInput{ChatID: e.ch, SenderID: 7, Text: "пост"}); err != nil {
		t.Fatal(err)
	}
	e.i.bg.Wait()
	if len(e.userFrames(8, "dialog_archive")) != 1 {
		t.Fatal("пост канала не вернул его из архива подписчика")
	}
}
