package domain

import "testing"

// A1-16: форма messageReplyHeader у сообщений треда — как у tweb при сборке
// заголовка (appMessagesManager.ts:4681-4694), и флаг forum_topic у тем
// форума (без него tweb кладёт сообщение форума в General,
// getMessageThreadId.ts:17-24).
func TestReplyHeader_ThreadForms(t *testing.T) {
	i64 := func(v int64) *int64 { return &v }
	cases := []struct {
		name        string
		msg         Message
		wantMsgID   int64
		wantTopID   int64
		forumTopic  bool
		wantNoReply bool
	}{
		{name: "простое сообщение темы", msg: Message{ThreadRootID: i64(12), ForumTopic: true},
			wantMsgID: 12, forumTopic: true},
		{name: "ответ внутри темы", msg: Message{ThreadRootID: i64(12), ReplyToID: i64(30), ForumTopic: true},
			wantMsgID: 30, wantTopID: 12, forumTopic: true},
		{name: "ответ на сам корень темы", msg: Message{ThreadRootID: i64(12), ReplyToID: i64(12), ForumTopic: true},
			wantMsgID: 12, forumTopic: true},
		{name: "General без ответа", msg: Message{}, wantNoReply: true},
		{name: "ответ в General", msg: Message{ReplyToID: i64(30)}, wantMsgID: 30},
		{name: "комментарий без ответа", msg: Message{ThreadRootID: i64(5)}, wantMsgID: 5},
		{name: "ответ в комментариях", msg: Message{ThreadRootID: i64(5), ReplyToID: i64(9)},
			wantMsgID: 9, wantTopID: 5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := tc.msg.replyHeader()
			if tc.wantNoReply {
				if h != nil {
					t.Fatalf("reply_to = %+v, ждали отсутствие", h)
				}
				return
			}
			if h == nil {
				t.Fatal("reply_to отсутствует")
			}
			if h.ReplyToMsgID != tc.wantMsgID || h.ReplyToTopID != tc.wantTopID {
				t.Errorf("reply_to_msg_id/top_id = %d/%d, ждали %d/%d", h.ReplyToMsgID, h.ReplyToTopID, tc.wantMsgID, tc.wantTopID)
			}
			if h.PFlags["forum_topic"] != tc.forumTopic {
				t.Errorf("pFlags.forum_topic = %v, ждали %v", h.PFlags["forum_topic"], tc.forumTopic)
			}
		})
	}
}
