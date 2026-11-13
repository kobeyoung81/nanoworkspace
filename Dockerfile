# This module's front end: a module-federation remote the portal loads at runtime.
FROM node:22-alpine AS ui

WORKDIR /src/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

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
COPY --from=ui /src/ui/dist /app/ui

ENV NANOSEC_WORKSPACE_UI_DIR=/app/ui
EXPOSE 8080
ENTRYPOINT ["nanoworkspace"]
CMD ["serve"]
