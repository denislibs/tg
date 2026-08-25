package http

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/messenger-denis/backend/internal/domain"
)

// Хвостовые витрины чата: у каждой был безымянный ключ-обёртка вокруг значения
// (`{"user_ids": …}`, `{"media": …}`, `{"id": …}`, `{"theme_id": …}`). Обёртка
// конструктора не имеет — записать её на проводе TL нечем.

func TestChatTails_ValuesTravelWithoutWrappers(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990110001")
	_, idB := signUp(t, h, pool, "+79990110002")

	peer := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB}))
	cid := itoa(peer)

	rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenA,
		map[string]any{"text": "привет", "client_msg_id": "x1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("сообщение: %d %s", rec.Code, rec.Body.String())
	}
	var sent struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)

	// Просмотревшие — ВЕКТОР объявленных строк, а не голые числа под именем поля.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/messages/"+itoa(sent.ID)+"/viewers", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("просмотревшие: %d %s", rec.Code, rec.Body.String())
	}
	var viewers []struct {
		Underscore string `json:"_"`
		UserID     int64  `json:"user_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &viewers); err != nil {
		t.Fatalf("просмотревшие не вектор: %v (%s)", err, rec.Body.String())
	}
	for _, v := range viewers {
		if v.Underscore != "readParticipantDate" {
			t.Fatalf("строка просмотревших не конструктором: %s", rec.Body.String())
		}
	}

	// «Сообщение этой даты» — САМ номер, а не число под ключом `id`.
	rec = authedReq(t, h, http.MethodGet, "/chats/"+cid+"/message_by_date?date=1", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("сообщение по дате: %d %s", rec.Code, rec.Body.String())
	}
	var seq int64
	if err := json.Unmarshal(rec.Body.Bytes(), &seq); err != nil || seq == 0 {
		t.Fatalf("номер приехал не числом: %v (%s)", err, rec.Body.String())
	}

	// Участники видеочата — вектор ССЫЛОК `peerUser`, а не голых ключей.
	// Контейнера `phone.groupCall` тут нет намеренно: у оригинала звонок —
	// серверная конференция со своим объектом и SSRC участника, у нас
	// P2P-mesh. Перенимается адресация, а не выдуманный объект.
	// Видеочат бывает у ГРУППЫ, и адресуется она отрицательным ключом, из
	// которого id строки чата выводится напрямую. В звонок сажаем без HTTP:
	// вход — кадр сокета.
	rec = authedReq(t, h, http.MethodPost, "/groups", tokenA, map[string]any{
		"title": "Видеочат", "member_ids": []int64{idB},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("создание группы: %d %s", rec.Code, rec.Body.String())
	}
	groupPeer := createdPeerID(t, rec)
	if err := testGroupCalls.Join(t.Context(), domain.PeerID(groupPeer).ToChatID(), idA); err != nil {
		t.Fatalf("вход в звонок: %v", err)
	}
	rec = authedReq(t, h, http.MethodGet, "/chats/"+itoa(groupPeer)+"/group_call", tokenA, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("видеочат: %d %s", rec.Code, rec.Body.String())
	}
	var peers []struct {
		Underscore string `json:"_"`
		UserID     int64  `json:"user_id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &peers); err != nil {
		t.Fatalf("участники не вектор: %v (%s)", err, rec.Body.String())
	}
	if len(peers) != 1 || peers[0].Underscore != "peerUser" || peers[0].UserID != idA {
		t.Fatalf("участники = %+v; ожидался один peerUser с ключом %d", peers, idA)
	}

	// Тема чата: эхо запроса ответом не является — «получилось» конструктором.
	rec = authedReq(t, h, http.MethodPut, "/chats/"+cid+"/theme", tokenA, map[string]any{"theme_id": "sunset"})
	if rec.Code != http.StatusOK {
		t.Fatalf("тема: %d %s", rec.Code, rec.Body.String())
	}
	if !isBoolTrue(rec.Body.Bytes()) {
		t.Fatalf("тема = %s; ожидался boolTrue", rec.Body.String())
	}

	// «Избранное» — тот же конструктор ключа, что у создания чата.
	if saved := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/saved", tokenA, map[string]any{})); saved != idA {
		t.Fatalf("ключ «Избранного» = %d, ожидался %d", saved, idA)
	}
}

// Опрос уезжает САМИМ конструктором медиа: обёртки `{"media": …}` больше нет.
func TestChatTails_PollMediaHasNoWrapper(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, _ := signUp(t, h, pool, "+79990110003")
	_, idB := signUp(t, h, pool, "+79990110004")

	peer := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB}))
	cid := itoa(peer)
	if rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenA,
		map[string]any{"text": "привет", "client_msg_id": "p0"}); rec.Code != http.StatusOK {
		t.Fatalf("первое сообщение: %d %s", rec.Code, rec.Body.String())
	}

	rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/polls", tokenA, map[string]any{
		"question": "Кто?", "options": []string{"я", "не я"},
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("опрос: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Media struct {
			Poll struct {
				ID int64 `json:"id"`
			} `json:"poll"`
		} `json:"media"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.Media.Poll.ID == 0 {
		t.Fatalf("опрос не создан: %s", rec.Body.String())
	}

	rec = authedReq(t, h, http.MethodPost, "/polls/"+itoa(created.Media.Poll.ID)+"/vote", tokenA,
		map[string]any{"options": []int{0}})
	if rec.Code != http.StatusOK {
		t.Fatalf("голос: %d %s", rec.Code, rec.Body.String())
	}
	var media struct {
		Underscore string `json:"_"`
		Media      any    `json:"media"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &media)
	if media.Underscore != "messageMediaPoll" {
		t.Fatalf("голос = %s; ожидался конструктор медиа в корне", rec.Body.String())
	}
	if media.Media != nil {
		t.Fatalf("обёртка `media` осталась: %s", rec.Body.String())
	}
}

// Витрина ⭐-реакции — КАДР `updateMessageReactions` в контейнере `updates`.
//
// Прежде она отдавала безымянную тройку: пару `{total, mine}` под ключом
// `star_reaction`, список отправителей с ВКЛЕЕННОЙ карточкой в каждой строке и
// баланс. У оригинала всё это один предмет — агрегат реакций сообщения.
func TestChatTails_StarReactionIsAReactionsFrame(t *testing.T) {
	h, pool := newMessagingRouter(t)
	tokenA, idA := signUp(t, h, pool, "+79990120001")
	tokenB, idB := signUp(t, h, pool, "+79990120002")

	peer := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenA, map[string]int64{"user_id": idB}))
	cid := itoa(peer)
	rec := authedReq(t, h, http.MethodPost, "/chats/"+cid+"/messages", tokenA,
		map[string]any{"text": "пост", "client_msg_id": "s1"})
	if rec.Code != http.StatusOK {
		t.Fatalf("сообщение: %d %s", rec.Code, rec.Body.String())
	}
	var sent struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)

	// B пополняет баланс и ставит платную реакцию.
	if rec := authedReq(t, h, http.MethodPost, "/stars/topup", tokenB, map[string]any{"amount": 100}); rec.Code != http.StatusOK {
		t.Fatalf("пополнение: %d %s", rec.Code, rec.Body.String())
	}
	peerB := createdPeerFrom(t, authedReq(t, h, http.MethodPost, "/chats", tokenB, map[string]int64{"user_id": idA}))
	rec = authedReq(t, h, http.MethodPost, "/chats/"+itoa(peerB)+"/messages/"+itoa(sent.ID)+"/star_reaction", tokenB,
		map[string]any{"count": 5, "anonymous": false})
	if rec.Code != http.StatusOK {
		t.Fatalf("⭐-реакция: %d %s", rec.Code, rec.Body.String())
	}

	var out struct {
		Underscore string `json:"_"`
		Updates    []struct {
			Underscore string `json:"_"`
			MsgID      int64  `json:"msg_id"`
			Reactions  struct {
				Underscore string `json:"_"`
				Results    []struct {
					Reaction struct {
						Underscore string `json:"_"`
					} `json:"reaction"`
					Count int `json:"count"`
				} `json:"results"`
				TopReactors []struct {
					Underscore string          `json:"_"`
					PFlags     map[string]bool `json:"pFlags"`
					Count      int             `json:"count"`
					PeerID     *struct {
						UserID int64 `json:"user_id"`
					} `json:"peer_id"`
				} `json:"top_reactors"`
			} `json:"reactions"`
		} `json:"updates"`
		Users []struct {
			ID int64 `json:"id"`
		} `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("витрина не разбирается: %v (%s)", err, rec.Body.String())
	}
	if out.Underscore != "updates" || len(out.Updates) != 1 ||
		out.Updates[0].Underscore != "updateMessageReactions" {
		t.Fatalf("витрина = %s", rec.Body.String())
	}
	res := out.Updates[0].Reactions
	if len(res.Results) != 1 || res.Results[0].Reaction.Underscore != "reactionPaid" || res.Results[0].Count != 5 {
		t.Fatalf("чип платной реакции = %s", rec.Body.String())
	}
	// Личный вклад живёт в СТРОКЕ доски с флагом `my`, а не отдельной парой
	// {total, mine} рядом с чипами.
	var mine, other bool
	for _, x := range res.TopReactors {
		if x.PFlags["my"] {
			mine = x.Count == 5
			continue
		}
		other = x.PeerID != nil && x.PeerID.UserID == idB
	}
	if !mine || !other {
		t.Fatalf("доска отправителей = %s", rec.Body.String())
	}
	// Карточка отправителя едет ВЕКТОРОМ, а не вклеенной в строку доски.
	var card bool
	for _, u := range out.Users {
		if u.ID == idB {
			card = true
		}
	}
	if !card {
		t.Fatalf("карточка отправителя не доехала вектором: %s", rec.Body.String())
	}
	// Баланса рядом больше нет: его владелец — кадр updateStarsBalance.
	if strings.Contains(rec.Body.String(), `"balance"`) {
		t.Fatalf("баланс остался вторым источником: %s", rec.Body.String())
	}
}
