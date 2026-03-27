const WebSocket = require('ws');
const chalk = require('chalk');
const { deriveKeys, encrypt, decrypt } = require('./crypto');
const { PACKET_TYPES, encode, decode } = require('./protocol');
const { showStatus, addChat } = require('./status');
const { isCtrlKey } = require('./keymatch');

function joinSession(sessionCode, options = {}) {
  const { roomId, encryptionKey } = deriveKeys(sessionCode);
  const relayUrl = options.relay || require('./constants').DEFAULT_RELAY_URL;

  let sendNonce = 0;
  let driver = false;
  let ws = null;
  let alive = true;

  // Set raw mode FIRST, before anything else
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  } catch (e) {
    console.error(chalk.red('❌ Cannot set raw mode on stdin. Are you running in a terminal?'));
    process.exit(1);
  }

  console.log(chalk.cyan('🔗 Connecting...'));

  ws = new WebSocket(relayUrl);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'join', room_id: roomId }));
  });

  ws.on('message', (data) => {
    const buf = Buffer.from(data);

    // Try JSON first (relay control messages)
    if (buf.length < 29 || !isValidPacketType(buf[0])) {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      handleRelayMessage(msg);
      return;
    }

    // Encrypted packet from host
    handleEncryptedPacket(buf);
  });

  ws.on('close', () => {
    if (alive) {
      console.log(chalk.red('\n🔌 Disconnected.'));
      cleanup();
    }
  });

  ws.on('error', (err) => {
    console.error(chalk.red(`\nConnection error: ${err.message}`));
    cleanup();
  });

  function isValidPacketType(byte) {
    return [0x01, 0x02, 0x03, 0x04, 0x10, 0x11, 0x12, 0x20, 0x21].includes(byte);
  }

  function handleRelayMessage(msg) {
    switch (msg.type) {
      case 'room_created':
        console.log(chalk.gray('⏳ Waiting for host...'));
        break;
      case 'peer_joined':
        console.log(chalk.green('✅ Connected to host session! (read-only)'));
        console.log(chalk.gray('💡 Ctrl+T = request/release drive, Ctrl+Q = quit'));
        break;
      case 'peer_left':
        console.log(chalk.yellow('\n👋 Host disconnected.'));
        cleanup();
        break;
      case 'room_full':
        console.log(chalk.red('❌ Session is full (2 participants max).'));
        cleanup();
        break;
      case 'error':
        console.error(chalk.red(`Error: ${msg.message}`));
        cleanup();
        break;
    }
  }

  function handleEncryptedPacket(data) {
    const { type, nonce, ciphertext, authTag } = decode(data);
    let plaintext;
    try {
      plaintext = decrypt(encryptionKey, nonce, ciphertext, authTag);
    } catch {
      return;
    }

    switch (type) {
      case PACKET_TYPES.TERMINAL_OUTPUT:
        process.stdout.write(plaintext);
        break;
      case PACKET_TYPES.RESIZE: {
        const dims = JSON.parse(plaintext.toString());
        process.stdout.write(`\x1b[8;${dims.rows};${dims.cols}t`);
        break;
      }
      case PACKET_TYPES.DRIVE_GRANT:
        driver = true;
        showStatus(chalk.green('🎮 You are now the driver! (Ctrl+T to release)'));
        break;
      case PACKET_TYPES.DRIVE_RELEASE:
        driver = false;
        showStatus(chalk.yellow('🎮 Host took back the driver role. (read-only)'));
        break;
      case PACKET_TYPES.CHAT:
        addChat(chalk.magenta('💬 Host: ') + plaintext.toString());
        break;
    }
  }

  function sendEncrypted(type, plaintext) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { ciphertext, authTag, nonce } = encrypt(encryptionKey, plaintext, sendNonce++);
    const packet = encode(type, nonce, ciphertext, authTag);
    ws.send(packet);
  }

  function requestDrive() {
    sendEncrypted(PACKET_TYPES.DRIVE_REQUEST, Buffer.alloc(0));
    showStatus(chalk.yellow('🙋 Drive request sent. Waiting for host to grant...'));
  }

  function releaseDrive() {
    driver = false;
    sendEncrypted(PACKET_TYPES.DRIVE_RELEASE, Buffer.alloc(0));
    showStatus(chalk.cyan('🎮 Driver role released.'));
  }

  let chatBuffer = '';

  function updateChatLine() {
    const rows = process.stdout.rows || 24;
    const prefix = chalk.gray('💬 ');
    process.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K${prefix}${chatBuffer}\x1b8`);
  }

  function clearChatLine() {
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K\x1b8`);
  }

  process.stdin.on('data', (data) => {
    const buf = Buffer.from(data);

    // Ctrl+Q -> quit
    if (isCtrlKey(buf, 'q')) {
      console.log(chalk.gray('\nDisconnecting...'));
      cleanup();
      return;
    }

    // Ctrl+T -> toggle drive
    if (isCtrlKey(buf, 't')) {
      if (!driver) {
        requestDrive();
      } else {
        releaseDrive();
      }
      chatBuffer = '';
      return;
    }

    if (driver) {
      sendEncrypted(PACKET_TYPES.TERMINAL_INPUT, buf);
    } else {
      // Chat/suggestion mode
      const str = buf.toString();

      // Enter -> send chat message
      if (str === '\r' || str === '\n') {
        if (chatBuffer.trim()) {
          sendEncrypted(PACKET_TYPES.CHAT, Buffer.from(chatBuffer));
          addChat(chalk.gray('💬 You: ' + chatBuffer));
        }
        chatBuffer = '';
        clearChatLine();
        return;
      }

      // Backspace (0x7f or 0x08)
      if (buf[0] === 0x7f || buf[0] === 0x08) {
        chatBuffer = chatBuffer.slice(0, -1);
        updateChatLine();
        return;
      }

      // Escape (0x1b) -> clear chat
      if (buf[0] === 0x1b && buf.length === 1) {
        chatBuffer = '';
        clearChatLine();
        return;
      }

      // Printable characters only
      if (str && !str.match(/[\x00-\x1f]/)) {
        chatBuffer += str;
        updateChatLine();
      }
    }
  });

  function cleanup() {
    alive = false;
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.pause();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    process.exit(0);
  }
}

module.exports = { joinSession };
