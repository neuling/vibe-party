const pty = require('node-pty');
const WebSocket = require('ws');
const chalk = require('chalk');
const { execSync } = require('child_process');
const { generateCode } = require('./wordlist');
const { deriveKeys, encrypt, decrypt } = require('./crypto');
const { PACKET_TYPES, encode, decode } = require('./protocol');
const { showStatus, addChat } = require('./status');
const { isCtrlKey } = require('./keymatch');

function startHost(options = {}) {
  const sessionCode = options.code || generateCode();
  const { roomId, encryptionKey } = deriveKeys(sessionCode);
  const relayUrl = options.relay || require('./constants').DEFAULT_RELAY_URL;

  let sendNonce = 0;
  let driver = 'host';
  let pendingDriveRequest = false;
  let ws = null;
  let ptyProcess = null;
  let alive = true;
  let hostChatBuffer = '';
  const outputBuffer = [];

  // Set raw mode FIRST, before anything else
  try {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  } catch (e) {
    console.error(chalk.red('❌ Cannot set raw mode on stdin. Are you running in a terminal?'));
    process.exit(1);
  }

  console.log(chalk.green.bold('🎉 Session started!'));
  console.log(chalk.cyan('📋 Your code: ') + chalk.white.bold(sessionCode));
  console.log(chalk.gray('⏳ Waiting for peer...'));
  console.log(chalk.gray('💡 Ctrl+T = grant drive, Ctrl+Q = quit'));
  console.log();

  // Resolve command to spawn
  const command = options.command || 'claude';
  const commandParts = command.split(/\s+/);
  const commandBin = commandParts[0];
  const commandArgs = commandParts.slice(1);

  let binPath;
  try {
    binPath = execSync(`which ${commandBin}`, { encoding: 'utf8' }).trim();
  } catch {
    console.error(chalk.red(`❌ Could not find "${commandBin}" in PATH.`));
    cleanup();
    return;
  }

  // Spawn PTY
  ptyProcess = pty.spawn(binPath, commandArgs, {
    name: 'xterm-256color',
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    cwd: process.cwd(),
    env: process.env,
  });

  // PTY output -> screen + buffer + encrypt -> relay
  ptyProcess.onData((data) => {
    process.stdout.write(data);
    outputBuffer.push(Buffer.from(data));
    // Cap buffer at ~1MB to avoid unbounded growth
    while (outputBuffer.length > 1000) outputBuffer.shift();
    sendEncrypted(PACKET_TYPES.TERMINAL_OUTPUT, Buffer.from(data));
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(chalk.gray(`\nClaude exited with code ${exitCode}.`));
    cleanup();
  });

  // Handle terminal resize
  process.stdout.on('resize', () => {
    if (ptyProcess) {
      ptyProcess.resize(process.stdout.columns, process.stdout.rows);
    }
    sendResize();
  });

  // Connect to relay
  ws = new WebSocket(relayUrl);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'join', room_id: roomId }));
  });

  ws.on('message', (data) => {
    const buf = Buffer.from(data);
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
    handleEncryptedPacket(buf);
  });

  ws.on('close', () => {
    if (alive) {
      console.log(chalk.red('\n🔌 Disconnected from relay.'));
    }
  });

  ws.on('error', (err) => {
    console.error(chalk.red(`\nRelay error: ${err.message}`));
  });

  function isValidPacketType(byte) {
    return [0x01, 0x02, 0x03, 0x04, 0x10, 0x11, 0x12, 0x20, 0x21].includes(byte);
  }

  function handleRelayMessage(msg) {
    switch (msg.type) {
      case 'room_created':
        break;
      case 'peer_joined':
        showStatus(chalk.green('✅ Peer connected! (read-only)'));
        sendResize();
        // Send buffered output so guest sees current screen state
        for (const chunk of outputBuffer) {
          sendEncrypted(PACKET_TYPES.TERMINAL_OUTPUT, chunk);
        }
        break;
      case 'peer_left':
        showStatus(chalk.yellow('👋 Peer disconnected.'));
        if (driver === 'guest') {
          driver = 'host';
          showStatus(chalk.cyan('🎮 You are now the driver.'));
        }
        break;
      case 'error':
        console.error(chalk.red(`Relay error: ${msg.message}`));
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
      case PACKET_TYPES.TERMINAL_INPUT:
        if (driver === 'guest' && ptyProcess) {
          ptyProcess.write(plaintext.toString());
        }
        break;
      case PACKET_TYPES.DRIVE_REQUEST:
        pendingDriveRequest = true;
        showStatus(chalk.yellow('🙋 Peer wants to drive! Press Ctrl+T to grant.'));
        break;
      case PACKET_TYPES.DRIVE_RELEASE:
        driver = 'host';
        showStatus(chalk.cyan('🎮 You are now the driver.'));
        break;
      case PACKET_TYPES.CHAT:
        addChat(chalk.magenta('💬 Guest: ') + plaintext.toString());
        break;
    }
  }

  function sendEncrypted(type, plaintext) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const { ciphertext, authTag, nonce } = encrypt(encryptionKey, plaintext, sendNonce++);
    const packet = encode(type, nonce, ciphertext, authTag);
    ws.send(packet);
  }

  function sendResize() {
    const dims = { cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
    sendEncrypted(PACKET_TYPES.RESIZE, Buffer.from(JSON.stringify(dims)));
  }

  function toggleDrive() {
    if (driver === 'guest') {
      // Revoke: take back control
      driver = 'host';
      pendingDriveRequest = false;
      sendEncrypted(PACKET_TYPES.DRIVE_RELEASE, Buffer.alloc(0));
      showStatus(chalk.cyan('🎮 You took back the driver role.'));
    } else if (pendingDriveRequest) {
      // Grant pending request
      pendingDriveRequest = false;
      driver = 'guest';
      sendEncrypted(PACKET_TYPES.DRIVE_GRANT, Buffer.alloc(0));
      showStatus(chalk.cyan('🎮 Peer is now the driver.'));
    }
  }

  function updateHostChatLine() {
    const rows = process.stdout.rows || 24;
    const prefix = chalk.gray('💬 ');
    process.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K${prefix}${hostChatBuffer}\x1b8`);
  }

  function clearHostChatLine() {
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K\x1b8`);
  }

  // Stdin handler
  process.stdin.on('data', (data) => {
    const buf = Buffer.from(data);

    // Ctrl+T -> toggle drive
    if (isCtrlKey(buf, 't')) {
      toggleDrive();
      return;
    }

    // Ctrl+Q -> quit
    if (isCtrlKey(buf, 'q')) {
      console.log(chalk.gray('\nDisconnecting...'));
      cleanup();
      return;
    }

    if (driver === 'host') {
      // Host is driving -> forward to PTY
      if (ptyProcess) {
        ptyProcess.write(data.toString());
      }
    } else {
      // Guest is driving -> host can chat
      const str = buf.toString();

      if (str === '\r' || str === '\n') {
        if (hostChatBuffer.trim()) {
          sendEncrypted(PACKET_TYPES.CHAT, Buffer.from(hostChatBuffer));
          addChat(chalk.gray('💬 You: ' + hostChatBuffer));
        }
        hostChatBuffer = '';
        clearHostChatLine();
        return;
      }

      // Backspace
      if (buf[0] === 0x7f || buf[0] === 0x08) {
        hostChatBuffer = hostChatBuffer.slice(0, -1);
        updateHostChatLine();
        return;
      }

      // Escape -> clear
      if (buf[0] === 0x1b && buf.length === 1) {
        hostChatBuffer = '';
        clearHostChatLine();
        return;
      }

      // Printable characters
      if (str && !str.match(/[\x00-\x1f]/)) {
        hostChatBuffer += str;
        updateHostChatLine();
      }
    }
  });

  function cleanup() {
    alive = false;
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.pause();
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    process.exit(0);
  }
}

module.exports = { startHost };
