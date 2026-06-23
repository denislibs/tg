package config

import (
	"fmt"
	"os"
)

type Config struct {
	HTTPAddr    string
	DatabaseURL string
	RedisURL    string
	DevOTPCode  string

	MinioEndpoint  string
	MinioAccessKey string
	MinioSecretKey string
	MinioBucket    string
	MinioUseSSL    bool
}

func Load() (*Config, error) {
	c := &Config{
		HTTPAddr:    getenv("HTTP_ADDR", ":8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		RedisURL:    getenv("REDIS_URL", "redis://localhost:6379"),
		DevOTPCode:  getenv("DEV_OTP_CODE", "12345"),
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	c.MinioEndpoint = getenv("MINIO_ENDPOINT", "localhost:9000")
	c.MinioAccessKey = getenv("MINIO_ACCESS_KEY", "minioadmin")
	c.MinioSecretKey = getenv("MINIO_SECRET_KEY", "minioadmin")
	c.MinioBucket = getenv("MINIO_BUCKET", "media")
	c.MinioUseSSL = getenv("MINIO_USE_SSL", "false") == "true"
	return c, nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
