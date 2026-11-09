# syntax=docker/dockerfile:1.7
# Targets: dev (air, recarga en caliente) · build (binario estático) · prod (scratch, usuario no root)
ARG GO_VERSION=1.27.3
FROM golang:${GO_VERSION}-trixie AS base
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
WORKDIR /app

FROM base AS dev
ARG AIR_VERSION=v1.67.4
RUN go install github.com/air-verse/air@${AIR_VERSION}
COPY go.mod go.sum ./
# Modules and staticcheck (the go.mod `tool` directive) stay in the image: verify and test need no network.
RUN go mod download && go tool staticcheck -version
COPY . .
EXPOSE 8080
CMD ["air", "-c", ".air.toml"]

FROM base AS build
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w" -o /out/app/api ./cmd/api \
 && mkdir -p /out/app/data /out/tmp && chmod 1777 /out/tmp

# scratch: no shell and no packages, only the binary and the CA certificates. The healthcheck is the binary itself.
FROM scratch AS prod
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/tmp /tmp
# The SQLite volume (/app/data) takes its owner from the image.
COPY --from=build --chown=1001:1001 /out/app /app
USER 1001:1001
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["/app/api", "healthcheck"]
ENTRYPOINT ["/app/api"]
CMD ["serve"]
