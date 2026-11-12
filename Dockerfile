FROM golang:1.25-alpine AS builder

WORKDIR /src
RUN go env -w GO111MODULE=on
RUN go env -w GOPROXY=https://goproxy.cn,direct
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download

COPY . .

ARG VERSION=dev
ARG LDFLAGS="-s -w -X main.version=${VERSION}"
RUN CGO_ENABLED=0 go build -ldflags "${LDFLAGS}" -o /bin/nanoworkspace ./cmd/nanoworkspace

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /bin/nanoworkspace /usr/local/bin/nanoworkspace
EXPOSE 8080
ENTRYPOINT ["nanoworkspace"]
CMD ["serve"]
