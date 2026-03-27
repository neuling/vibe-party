const MAX_CHAT_LINES = 4;
const chatHistory = [];

// Add a chat message and redraw the chat area
function addChat(msg) {
  chatHistory.push(msg);
  if (chatHistory.length > MAX_CHAT_LINES) chatHistory.shift();
  renderChat();
}

// Render persistent chat lines at the bottom of the terminal
function renderChat() {
  const rows = process.stdout.rows || 24;
  let out = '\x1b7'; // save cursor
  for (let i = 0; i < MAX_CHAT_LINES; i++) {
    const row = rows - MAX_CHAT_LINES + 1 + i;
    const line = chatHistory[i] || '';
    out += `\x1b[${row};1H\x1b[2K${line}`;
  }
  out += '\x1b8'; // restore cursor
  process.stdout.write(out);
}

// Show a status message on the line above the chat area
function showStatus(msg) {
  const rows = process.stdout.rows || 24;
  const statusRow = rows - MAX_CHAT_LINES;
  process.stdout.write(
    `\x1b7\x1b[${statusRow};1H\x1b[2K${msg}\x1b8`
  );
}

module.exports = { showStatus, addChat, renderChat, MAX_CHAT_LINES };
