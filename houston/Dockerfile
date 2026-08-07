FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/alert-service .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /out/alert-service /usr/local/bin/alert-service
EXPOSE 8081
EXPOSE 9091
ENTRYPOINT ["/usr/local/bin/alert-service"]
