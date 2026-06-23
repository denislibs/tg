package domain

import "encoding/json"

type Update struct {
	Pts      int64
	PtsCount int
	Type     string
	Payload  json.RawMessage
}

type UserState struct {
	Pts  int64 `json:"pts"`
	Date int64 `json:"date"`
}
