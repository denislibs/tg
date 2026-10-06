package domain

import (
	"bytes"
	"encoding/json"
	"strings"
)

// PeerRefs — ССЫЛКИ на пиров внутри тела ответа или апдейта: id
// пользователей и чатов, чьи карточки обязаны ехать рядом векторами
// `users`/`chats` контейнера.
//
// Зачем вывод из самого провода, а не список полей у каждой витрины. У
// оригинала `users`/`chats` — обязательные параметры любого контейнера
// (messages.messages, updates, updates.difference…), и клиент рисует подпись,
// не спрашивая ни о ком отдельно (tweb appMessagesManager.saveApiResult,
// apiUpdatesManager.processUpdateMessage :259-262). Ссылок в схеме немного
// видов — конструкторы Peer и параметры-id пользователя/канала, — а мест, где
// они встречаются, десятки (peer_id, from_id, fwd_from, reply_to,
// replies.channel_id, recent_repliers, действие, упоминание, контакт, кадры
// typing/реакций/просмотров). Перечень полей у каждой витрины уже разошёлся
// однажды: история возила авторов, а каналы пересылок, ответов и обсуждений —
// никто (A4-03). Здесь правило одно и смотрит на сам провод.
type PeerRefs struct {
	Users []int64 `json:"u,omitempty"`
	Chats []int64 `json:"c,omitempty"`
}

// FrameRefsKey — служебный ключ конверта кадра WS, где отправитель кладёт
// ссылки тела (PeerRefs), посчитанные ОДИН раз при сборке кадра: соединению
// остаётся отфильтровать их по уже отданным, не разбирая тело (A4-05).
const FrameRefsKey = "_refs"

// Empty — ссылок нет.
func (r PeerRefs) Empty() bool { return len(r.Users) == 0 && len(r.Chats) == 0 }

// userIDKeys — параметры схемы, несущие id ПОЛЬЗОВАТЕЛЯ голым числом.
var userIDKeys = map[string]bool{
	"user_id":     true, // updateUserTyping, messageMediaContact, messageEntityMentionName, messageActionChatDeleteUser…
	"inviter_id":  true, // messageActionChatJoinedByLink
	"via_bot_id":  true, // message.via_bot_id
	"bot_id":      true,
	"admin_id":    true, // chatInviteExported.admin_id
	"kicked_by":   true, // channelParticipantBanned.kicked_by
	"promoted_by": true, // channelParticipantAdmin.promoted_by
}

// CollectPeerRefs — ссылки на пиров в значении v (конструктор или пачка
// конструкторов), без повторов, в порядке появления. Векторы `users`/`chats`,
// уже лежащие внутри v (вложенный контейнер — chat_full кадра), ссылками не
// считаются: это сами карточки.
func CollectPeerRefs(v any) PeerRefs {
	b, err := json.Marshal(v)
	if err != nil {
		return PeerRefs{}
	}
	return CollectPeerRefsJSON(b)
}

// CollectPeerRefsJSON — то же по уже собранному JSON (тело кадра, строка
// журнала).
func CollectPeerRefsJSON(raw []byte) PeerRefs {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var tree any
	if err := dec.Decode(&tree); err != nil {
		return PeerRefs{}
	}
	c := peerRefCollector{users: map[int64]bool{}, chats: map[int64]bool{}}
	c.walk(tree, "")
	return c.out
}

type peerRefCollector struct {
	users, chats map[int64]bool
	out          PeerRefs
}

func (c *peerRefCollector) user(id int64) {
	if id > 0 && !c.users[id] {
		c.users[id] = true
		c.out.Users = append(c.out.Users, id)
	}
}

func (c *peerRefCollector) chat(id int64) {
	if id > 0 && !c.chats[id] {
		c.chats[id] = true
		c.out.Chats = append(c.out.Chats, id)
	}
}

func refInt(v any) (int64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	id, err := n.Int64()
	return id, err == nil
}

func (c *peerRefCollector) walk(v any, key string) {
	switch t := v.(type) {
	case []any:
		for _, e := range t {
			c.walk(e, key)
		}
	case map[string]any:
		tag, _ := t["_"].(string)
		switch tag {
		case PeerUserTag:
			if id, ok := refInt(t["user_id"]); ok {
				c.user(id)
			}
			return
		case PeerChannelTag:
			if id, ok := refInt(t["channel_id"]); ok {
				c.chat(id)
			}
			return
		case PeerChatTag:
			if id, ok := refInt(t["chat_id"]); ok {
				c.chat(id)
			}
			return
		}
		for k, e := range t {
			switch {
			case userIDKeys[k]:
				if id, ok := refInt(e); ok {
					c.user(id)
					continue
				}
			case k == "channel_id":
				if id, ok := refInt(e); ok {
					c.chat(id)
					continue
				}
			case k == "peer_id":
				// Голый PeerID (наш ключ пира у кадров без сообщения, см.
				// withPeer): ≥ 0 — пользователь, < 0 — чат.
				if id, ok := refInt(e); ok {
					if id >= 0 {
						c.user(id)
					} else {
						c.chat(-id)
					}
					continue
				}
			case k == "users" || k == "chats":
				// Голые id участников действия (messageActionChatAddUser.users)
				// — ссылки; вектор карточек вложенного контейнера — нет.
				if k == "users" && strings.HasPrefix(tag, "messageAction") {
					if list, ok := e.([]any); ok {
						for _, x := range list {
							if id, ok := refInt(x); ok {
								c.user(id)
							}
						}
					}
				}
				continue
			}
			c.walk(e, k)
		}
	}
}
