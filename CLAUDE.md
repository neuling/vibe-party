# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

vibe-party is a CLI tool for multiplayer AI coding sessions over the internet. One user hosts (spawning an AI coding CLI via node-pty), another joins with a session code. Terminal output is streamed E2E-encrypted through a WebSocket relay. A driver/passenger model controls who can type.

## Architecture

Three components:

- **Relay Server** (`server/`): Minimal WebSocket relay on Node.js + `ws`. Routes opaque encrypted bytes by room_id. Never sees plaintext. Max 2 clients per room.
- **Host CLI** (`src/host.js`): Spawns `claude` via `node-pty`, streams encrypted PTY output to relay, receives driver input, manages driver state.
- **Guest CLI** (`src/guest.js`): Connects to relay, decrypts and renders terminal output (raw ANSI to stdout), sends keystrokes when in driver role.

Entry point: `bin/vibe-party.js` -> `src/cli.js` (commander.js).

## Key Design Decisions

- **Session codes** (e.g. `tiger-piano-sunset-4821`) serve dual purpose: hashed for room routing, derived via PBKDF2 for AES-256-GCM encryption key. Relay only sees the hash.
- **Packet format**: `[1-byte type][12-byte nonce][ciphertext][16-byte auth tag]`. Types: 0x01 terminal_output, 0x02 terminal_input, 0x03 resize, 0x04 chat, 0x10-0x12 drive control, 0x20-0x21 ping/pong.
- **Nonce management**: Incrementing counter per direction (no reuse).
- **Terminal rendering**: Raw ANSI pipe. Guest auto-resizes to match host.

## Commands

```bash
npm install                    # CLI package (root)
cd server && npm install       # Relay server
node server/index.js           # Relay on port 8080
node bin/vibe-party.js host    # Start hosting
node bin/vibe-party.js join <code>  # Join a session
npm test                       # All tests
npx jest test/crypto.test.js   # Single test file
```

## Crypto Module (`src/crypto.js`)

Key derivation from session code:
- `salt = SHA256(session_code)`
- `room_id = SHA256("room:" + session_code).hex().slice(0, 16)`
- `encryption_key = PBKDF2(session_code, salt, 100000, 32, 'sha512')`

All using Node.js native `crypto` module.

## Language

Code, comments, and variable names are in English. UI strings may contain emoji.
