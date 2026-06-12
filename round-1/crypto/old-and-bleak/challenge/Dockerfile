FROM golang:1.24.2-alpine AS builder
WORKDIR /app
ENV GODEBUG=rsa1024min=0

COPY go.mod ./
RUN go mod download

COPY main.go main_test.go ./
COPY internal ./internal
COPY static ./static
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o old-and-bleak .

FROM alpine:3.21
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app
ENV GODEBUG=rsa1024min=0
COPY --from=builder /app/old-and-bleak ./
COPY --from=builder /app/static ./static

USER app
EXPOSE 3000
CMD ["./old-and-bleak"]
