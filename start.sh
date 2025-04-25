#!/bin/sh

set -e

# Convenient start script for UCI clients to run

cd "$(dirname "$0")"
exec deno run --allow-all examples/gleam-chess-tournament-adapter.ts "$@"
