FROM golang:1.26-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /koe-server ./cmd/server

FROM alpine:3.21

RUN apk add --no-cache ffmpeg

COPY --from=builder /koe-server /usr/local/bin/koe-server

EXPOSE 8080

ENTRYPOINT ["koe-server"]
