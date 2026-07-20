package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/messenger-denis/backend/internal/domain"
)

// fakeBotAPI — in-memory BotAPIRepo для тестов BotFather/Bot API.
type fakeBotAPI struct {
	seq      int64
	bots     map[int64]domain.BotAccount
	byOwner  map[int64][]int64
	commands map[int64][]domain.BotCommand
	apps     map[string]domain.BotApp
	wizard   map[int64]domain.BotWizard
	updates  map[int64][]domain.BotUpdate
	upSeq    int64
	cloud    map[string]string
}

func newFakeBotAPI() *fakeBotAPI {
	return &fakeBotAPI{
		seq: 500000, bots: map[int64]domain.BotAccount{}, byOwner: map[int64][]int64{},
		commands: map[int64][]domain.BotCommand{}, apps: map[string]domain.BotApp{},
		wizard: map[int64]domain.BotWizard{}, updates: map[int64][]domain.BotUpdate{},
	}
}

func (f *fakeBotAPI) CreateBot(_ context.Context, ownerID int64, name, username string) (domain.BotAccount, error) {
	f.seq++
	b := domain.BotAccount{BotID: f.seq, OwnerID: ownerID, Token: "tok", Username: username, Name: name}
	f.bots[b.BotID] = b
	f.byOwner[ownerID] = append(f.byOwner[ownerID], b.BotID)
	return b, nil
}
func (f *fakeBotAPI) BotByToken(_ context.Context, token string) (domain.BotAccount, error) {
	for _, b := range f.bots {
		if b.Token == token {
			return b, nil
		}
	}
	return domain.BotAccount{}, domain.ErrNotFound
}
func (f *fakeBotAPI) BotByID(_ context.Context, id int64) (domain.BotAccount, error) {
	if b, ok := f.bots[id]; ok {
		return b, nil
	}
	return domain.BotAccount{}, domain.ErrNotFound
}
func (f *fakeBotAPI) BotsByOwner(_ context.Context, ownerID int64) ([]domain.BotAccount, error) {
	var out []domain.BotAccount
	for _, id := range f.byOwner[ownerID] {
		out = append(out, f.bots[id])
	}
	return out, nil
}
func (f *fakeBotAPI) UsernameTaken(_ context.Context, username string) (bool, error) {
	for _, b := range f.bots {
		if strings.EqualFold(b.Username, username) {
			return true, nil
		}
	}
	return false, nil
}
func (f *fakeBotAPI) SetWebhook(_ context.Context, id int64, url string) error {
	b := f.bots[id]
	b.WebhookURL = url
	f.bots[id] = b
	return nil
}
func (f *fakeBotAPI) SetMenuButton(_ context.Context, id int64, text, url string) error {
	b := f.bots[id]
	b.MenuButtonText, b.MenuButtonURL = text, url
	f.bots[id] = b
	return nil
}
func (f *fakeBotAPI) RegenToken(_ context.Context, id int64) (string, error) {
	b := f.bots[id]
	b.Token = "tok2"
	f.bots[id] = b
	return b.Token, nil
}
func (f *fakeBotAPI) SetCommands(_ context.Context, id int64, _, _ string, cmds []domain.BotCommand) error {
	f.commands[id] = cmds
	return nil
}
func (f *fakeBotAPI) CommandsScoped(_ context.Context, id int64, _, _ string) ([]domain.BotCommand, error) {
	return f.commands[id], nil
}
func (f *fakeBotAPI) SetProfile(_ context.Context, id int64, description, about *string) error {
	b := f.bots[id]
	if description != nil {
		b.Description = *description
	}
	if about != nil {
		b.About = *about
	}
	f.bots[id] = b
	return nil
}
func (f *fakeBotAPI) SetInline(_ context.Context, id int64, enabled bool, placeholder string) error {
	b := f.bots[id]
	b.InlineEnabled, b.InlinePlaceholder = enabled, placeholder
	f.bots[id] = b
	return nil
}
func (f *fakeBotAPI) SetAvatar(_ context.Context, _, _ int64) error { return nil }
func (f *fakeBotAPI) CloudGet(_ context.Context, _, _ int64, keys []string) (map[string]string, error) {
	out := map[string]string{}
	for _, k := range keys {
		if v, ok := f.cloud[k]; ok {
			out[k] = v
		}
	}
	return out, nil
}
func (f *fakeBotAPI) CloudSet(_ context.Context, _, _ int64, key, value string) error {
	if f.cloud == nil {
		f.cloud = map[string]string{}
	}
	f.cloud[key] = value
	return nil
}
func (f *fakeBotAPI) CloudRemove(_ context.Context, _, _ int64, keys []string) error {
	for _, k := range keys {
		delete(f.cloud, k)
	}
	return nil
}
func (f *fakeBotAPI) CloudKeys(_ context.Context, _, _ int64) ([]string, error) {
	out := []string{}
	for k := range f.cloud {
		out = append(out, k)
	}
	return out, nil
}
func (f *fakeBotAPI) EnqueueUpdate(_ context.Context, botID int64, payload []byte) (int64, error) {
	f.upSeq++
	f.updates[botID] = append(f.updates[botID], domain.BotUpdate{UpdateID: f.upSeq, Payload: payload})
	return f.upSeq, nil
}
func (f *fakeBotAPI) PullUpdates(_ context.Context, botID, offset int64, _ int) ([]domain.BotUpdate, error) {
	var out []domain.BotUpdate
	for _, u := range f.updates[botID] {
		if u.UpdateID >= offset {
			out = append(out, u)
		}
	}
	return out, nil
}
func (f *fakeBotAPI) CreateApp(_ context.Context, app domain.BotApp) error {
	f.apps[app.ShortName] = app
	return nil
}
func (f *fakeBotAPI) AppByShortName(_ context.Context, _ int64, short string) (domain.BotApp, error) {
	if a, ok := f.apps[short]; ok {
		return a, nil
	}
	return domain.BotApp{}, domain.ErrNotFound
}
func (f *fakeBotAPI) AppsByBot(_ context.Context, botID int64) ([]domain.BotApp, error) {
	var out []domain.BotApp
	for _, a := range f.apps {
		if a.BotID == botID {
			out = append(out, a)
		}
	}
	return out, nil
}
func (f *fakeBotAPI) WizardGet(_ context.Context, uid int64) (domain.BotWizard, error) {
	return f.wizard[uid], nil
}
func (f *fakeBotAPI) WizardSet(_ context.Context, w domain.BotWizard) error {
	f.wizard[w.UserID] = w
	return nil
}
func (f *fakeBotAPI) WizardClear(_ context.Context, uid int64) error {
	delete(f.wizard, uid)
	return nil
}
func (f *fakeBotAPI) UserBrief(_ context.Context, _ int64) (string, string, error) {
	return "tester", "Tester", nil
}

// botFatherInteractor: чат владельца(1) ↔ @BotFather.
func botFatherInteractor(t *testing.T) (*Interactor, *store, *fakeBotAPI, int64) {
	t.Helper()
	in, s := newInteractor()
	in.SetBots(fakeBots{botIDs: map[int64]bool{domain.BotFatherID: true}})
	in.SetPublisher(&fakePublisher{})
	fapi := newFakeBotAPI()
	in.SetBotAPI(fapi)
	chatID, err := in.CreatePrivateChat(context.Background(), 1, domain.BotFatherID)
	if err != nil {
		t.Fatal(err)
	}
	return in, s, fapi, chatID
}

func lastText(s *store, chatID int64) string {
	msgs := s.messages[chatID]
	if len(msgs) == 0 {
		return ""
	}
	return msgs[len(msgs)-1].Text
}

func TestBotFatherNewBot(t *testing.T) {
	in, s, fapi, chatID := botFatherInteractor(t)
	ctx := context.Background()
	in.botFatherReply(ctx, chatID, 1, "/newbot")
	if !strings.Contains(lastText(s, chatID), "Как назовём") {
		t.Fatalf("expected name prompt, got %q", lastText(s, chatID))
	}
	in.botFatherReply(ctx, chatID, 1, "Мой Бот")
	if !strings.Contains(lastText(s, chatID), "username") {
		t.Fatalf("expected username prompt, got %q", lastText(s, chatID))
	}
	// невалидный username (не заканчивается на bot)
	in.botFatherReply(ctx, chatID, 1, "myservice")
	if !strings.Contains(lastText(s, chatID), "должен") {
		t.Fatalf("expected validation error, got %q", lastText(s, chatID))
	}
	// валидный
	in.botFatherReply(ctx, chatID, 1, "my_demo_bot")
	if len(fapi.byOwner[1]) != 1 {
		t.Fatalf("bot was not created: %+v", fapi.byOwner)
	}
	if !strings.Contains(lastText(s, chatID), "Токен") {
		t.Fatalf("expected token in final message, got %q", lastText(s, chatID))
	}
	if _, ok := fapi.wizard[1]; ok {
		t.Fatal("wizard should be cleared after creation")
	}
}

func TestBotFatherSetCommands(t *testing.T) {
	in, _, fapi, chatID := botFatherInteractor(t)
	ctx := context.Background()
	bot, _ := fapi.CreateBot(ctx, 1, "B", "b_bot")
	in.botFatherReply(ctx, chatID, 1, "/setcommands") // один бот → авто-выбор
	in.botFatherReply(ctx, chatID, 1, "start - запустить\nhelp - помощь")
	cmds := fapi.commands[bot.BotID]
	if len(cmds) != 2 || cmds[0].Command != "start" || cmds[0].Description != "запустить" {
		t.Fatalf("commands not set correctly: %+v", cmds)
	}
}

func TestBotFatherNewApp(t *testing.T) {
	in, _, fapi, chatID := botFatherInteractor(t)
	ctx := context.Background()
	_, _ = fapi.CreateBot(ctx, 1, "B", "b_bot")
	in.botFatherReply(ctx, chatID, 1, "/newapp")
	in.botFatherReply(ctx, chatID, 1, "Моя Игра")
	in.botFatherReply(ctx, chatID, 1, "game")
	in.botFatherReply(ctx, chatID, 1, "https://example.com/game")
	app, ok := fapi.apps["game"]
	if !ok || app.Title != "Моя Игра" || app.URL != "https://example.com/game" {
		t.Fatalf("app not created correctly: %+v", app)
	}
}

func TestBotAnswerCallbackDelivers(t *testing.T) {
	in, _, fapi, _ := botFatherInteractor(t)
	ctx := context.Background()
	bot, _ := fapi.CreateBot(ctx, 1, "B", "b_bot")
	done := make(chan domain.BotCallbackAnswer, 1)
	go func() { done <- in.botCallbackViaAPI(ctx, bot, 10, 1, 0, "ping") }()
	// достаём id из заэнкованного апдейта и отвечаем
	waitFor(t, func() bool { return len(fapi.updates[bot.BotID]) > 0 })
	var upd map[string]any
	_ = json.Unmarshal(fapi.updates[bot.BotID][0].Payload, &upd)
	cq := upd["callback_query"].(map[string]any)
	in.BotAnswerCallback(ctx, cq["id"].(string), "pong", true)
	ans := <-done
	if ans.Text != "pong" || !ans.Alert {
		t.Fatalf("callback answer not delivered: %+v", ans)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	for n := 0; n < 200; n++ {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("condition not met in time")
}
