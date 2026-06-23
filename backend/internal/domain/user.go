// Package domain holds the core entities, value objects, and errors. It has no
// dependency on any framework or infrastructure.
package domain

import "time"

type User struct {
	ID          int64
	Phone       string
	Username    *string
	DisplayName string
	AvatarURL   string
}

type Device struct {
	ID         int64
	UserID     int64
	Name       string
	Platform   string
	TokenHash  string
	LastActive time.Time
}

// Session is a resolved auth context (cached): who, on which device.
type Session struct {
	User     User
	DeviceID int64
}
