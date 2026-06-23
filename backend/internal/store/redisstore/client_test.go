package redisstore

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
)

func TestConnect_Ping(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	defer mr.Close()

	c, err := Connect(context.Background(), "redis://"+mr.Addr())
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer c.Close()
	if err := c.Ping(context.Background()).Err(); err != nil {
		t.Fatalf("ping: %v", err)
	}
}
