FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/server ./cmd/server

FROM alpine:latest
# ffmpeg (+ ffprobe) for server-side media processing: thumbnails/posters,
# probing dimensions/duration, and compression.
RUN apk add --no-cache ca-certificates ffmpeg
COPY --from=build /bin/server /bin/server
EXPOSE 8080
ENTRYPOINT ["/bin/server"]
