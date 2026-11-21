# This module's front end: a module-federation remote the portal loads at runtime.
FROM kobeyoung81/base-node:26.13.1-alpine3.24-r2 AS ui

WORKDIR /src/ui
COPY ui/package.json ui/package-lock.json ./
RUN --mount=type=cache,id=nanosec-npm,target=/root/.npm \
    npm ci --no-audit --no-fund --prefer-offline
COPY ui/ ./
RUN npm run build

FROM kobeyoung81/base-go:1.27.4-alpine3.24-r2 AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,id=nanosec-gomod,target=/root/go/pkg/mod \
    --mount=type=cache,id=nanosec-gocache,target=/root/.cache/go-build \
    go mod download

COPY . .

ARG VERSION=dev
ARG LDFLAGS="-s -w -X main.version=${VERSION}"
RUN --mount=type=cache,id=nanosec-gomod,target=/root/go/pkg/mod \
    --mount=type=cache,id=nanosec-gocache,target=/root/.cache/go-build \
    go build -trimpath -ldflags "${LDFLAGS}" -o /bin/nanoworkspace ./cmd/nanoworkspace

FROM kobeyoung81/base-runtime:alpine3.24.4-r2

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

COPY --from=builder /bin/nanoworkspace /usr/local/bin/nanoworkspace
COPY --from=ui /src/ui/dist /app/ui

ENV NANOSEC_WORKSPACE_UI_DIR=/app/ui
EXPOSE 8080
ENTRYPOINT ["nanoworkspace"]
CMD ["serve"]
