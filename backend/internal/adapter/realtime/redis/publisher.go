// Package redis bridges the messaging service to Redis pub/sub for
// cross-replica delivery.
package redis

import (
	"context"
	"fmt"

	"github.com/messenger-denis/backend/internal/domain"
	goredis "github.com/redis/go-redis/v9"
)

// UserChannel is the Redis pub/sub channel for a user's realtime frames.
func UserChannel(userID int64) string { return fmt.Sprintf("user:%d", userID) }

// RedisPublisher publishes frames to per-user Redis channels.
type RedisPublisher struct{ rdb *goredis.Client }

func NewRedisPublisher(rdb *goredis.Client) *RedisPublisher { return &RedisPublisher{rdb: rdb} }

func (p *RedisPublisher) PublishToUser(ctx context.Context, userID int64, frame []byte) error {
	return p.rdb.Publish(ctx, UserChannel(userID), frame).Err()
}

// PublishToUsers publishes per-user frames in one Redis pipeline (single
// round-trip) instead of N sequential PUBLISH calls — the group send fan-out.
func (p *RedisPublisher) PublishToUsers(ctx context.Context, userIDs []int64, frames [][]byte) error {
	if len(userIDs) == 0 {
		return nil
	}
	pipe := p.rdb.Pipeline()
	for i, uid := range userIDs {
		pipe.Publish(ctx, UserChannel(uid), frames[i])
	}
	_, err := pipe.Exec(ctx)
	return err
}

// ChannelTopic is the Redis pub/sub topic for a channel's posts.
//
// Ключ — ЗНАКОВЫЙ идентификатор пира (-channelID), а не id строки chats: одно
// пространство адресов на провод, журналы и Redis (usecase/chat/peeraddr.go).
// Формат ключа изменился в шаге B — старый и новый инстанс на живом деплое
// пишут в РАЗНЫЕ топики, см. отчёт.
func ChannelTopic(channelID int64) string {
	return fmt.Sprintf("channel:%d", domain.ToPeerID(channelID, true))
}

// PublishToChannel publishes a frame once to a channel's topic. Subscribers are
// fanned out per-replica by the WS Hub, so a channel post is O(1) regardless of
// the number of subscribers.
func (p *RedisPublisher) PublishToChannel(ctx context.Context, channelID int64, frame []byte) error {
	return p.rdb.Publish(ctx, ChannelTopic(channelID), frame).Err()
}

// DeviceChannel is the Redis control channel for a device (close-on-revoke).
func DeviceChannel(deviceID int64) string { return fmt.Sprintf("device:%d", deviceID) }

// NotifyRevoked publishes a close signal on the device's control channel so the
// WS hub can drop that device's live socket. Implements auth.RevocationNotifier.
func (p *RedisPublisher) NotifyRevoked(ctx context.Context, deviceID int64) error {
	return p.rdb.Publish(ctx, DeviceChannel(deviceID), "close").Err()
}
