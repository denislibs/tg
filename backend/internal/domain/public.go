package domain

import "time"

// Публичные страницы-превью (аналог t.me): их читает АНОНИМ, поэтому здесь
// только то, что t.me показывает любому посетителю.

// PublicProfile — публичная карточка по username (t.me/username):
// пользователь, бот или группа/канал с публичным именем.
type PublicProfile struct {
	Kind          string // 'user' | 'bot' | 'group' | 'channel'
	Title         string
	Username      string
	About         string // bio пользователя / описание чата
	AvatarMediaID int64  // 0 — нет фото
	MemberCount   int    // только для групп/каналов
	Verified      bool
}

// PublicInvite — чат за действующей ссылкой-приглашением (t.me/+hash).
type PublicInvite struct {
	Kind          string // 'group' | 'channel'
	Title         string
	About         string
	AvatarMediaID int64
	MemberCount   int
}

// PublicStickerSet — набор по короткому имени (t.me/addstickers/name).
type PublicStickerSet struct {
	ShortName string
	Title     string
	Emoji     bool // набор эмодзи (t.me/addemoji/name)
}

// PublicPost — пост публичного канала (t.me/username/N).
type PublicPost struct {
	Channel   PublicProfile
	Seq       int64
	Text      string
	Entities  MessageEntities
	MediaID   int64 // 0 — без картинки; только image/*
	MediaW    int
	MediaH    int
	Views     int64
	CreatedAt time.Time
}
