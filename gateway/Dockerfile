# Multi-stage build for the Plexus Gateway.
# Produces a small static binary on a minimal alpine runtime.

FROM golang:1.26-alpine AS build
WORKDIR /src
# Leverage layer cache for deps.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# CGO off for a fully static binary; trim debug info for smaller size.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/gateway .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /out/gateway /usr/local/bin/gateway
# Public WebSocket port
EXPOSE 8080
# Metrics port (private 6PN)
EXPOSE 9090
ENTRYPOINT ["/usr/local/bin/gateway"]
