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
RUN CGO_ENABLED=0 go build -trimpath -ldflags "${LDFLAGS}" -o /bin/nanoworkspace ./cmd/nanoworkspace

FROM alpine:3.19

# Build metadata. All three come from the tagged commit (the version tag, the
# commit sha, and that commit's time), so two builds of one tag describe the same
# moment. `created` must be RFC 3339; the build script passes the commit time.
ARG VERSION=dev
ARG COMMIT=none
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="nanoworkspace" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://gitee.com/kobeyoung81/nanoworkspace" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /bin/nanoworkspace /usr/local/bin/nanoworkspace
COPY --from=ui /src/ui/dist /app/ui

ENV NANOSEC_WORKSPACE_UI_DIR=/app/ui
EXPOSE 8080
ENTRYPOINT ["nanoworkspace"]
CMD ["serve"]
