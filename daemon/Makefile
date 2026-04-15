.PHONY: build build-send test clean all

all: build build-send

build:
	go build -o unfaded ./cmd/unfaded

build-send:
	go build -o unfade-send ./cmd/unfade-send

test:
	go test ./...

clean:
	rm -f unfaded unfade-send
