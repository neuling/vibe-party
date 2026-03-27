const WebSocket = require('ws');

function createServer(port, options = {}) {
  const rooms = new Map();
  const ipAttempts = new Map();
  const RATE_LIMIT_MAX = options.rateLimitMax || 5;
  const RATE_LIMIT_WINDOW = options.rateLimitWindow || 60000;
  const wss = new WebSocket.Server({ port });

  wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    let roomId = null;
    let joined = false;

    ws.on('message', (data, isBinary) => {
      if (!joined) {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
          ws.close();
          return;
        }

        if (msg.type !== 'join' || !msg.room_id) {
          ws.send(JSON.stringify({ type: 'error', message: 'First message must be join' }));
          ws.close();
          return;
        }

        // Rate limiting
        const now = Date.now();
        const attempts = ipAttempts.get(ip) || [];
        const recent = attempts.filter((t) => now - t < RATE_LIMIT_WINDOW);
        if (recent.length >= RATE_LIMIT_MAX) {
          ws.send(JSON.stringify({ type: 'error', message: 'Rate limited' }));
          ws.close();
          return;
        }
        recent.push(now);
        ipAttempts.set(ip, recent);

        roomId = msg.room_id;
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Set());
        }
        const clients = rooms.get(roomId);
        if (clients.size >= 2) {
          ws.send(JSON.stringify({ type: 'room_full' }));
          ws.close();
          return;
        }

        clients.add(ws);
        joined = true;

        if (clients.size === 1) {
          ws.send(JSON.stringify({ type: 'room_created' }));
        } else {
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'peer_joined' }));
            }
          }
        }
        return;
      }

      // After join: forward all messages to the other client
      const clients = rooms.get(roomId);
      if (!clients) return;
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      }
    });

    ws.on('close', () => {
      if (roomId && rooms.has(roomId)) {
        const clients = rooms.get(roomId);
        clients.delete(ws);
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'peer_left' }));
          }
        }
        if (clients.size === 0) {
          rooms.delete(roomId);
        }
      }
    });

    // Heartbeat
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 10000);

  wss.on('close', () => clearInterval(heartbeat));

  const originalClose = wss.close.bind(wss);
  wss.close = (cb) => {
    clearInterval(heartbeat);
    for (const client of wss.clients) {
      client.terminate();
    }
    originalClose(cb);
  };

  return wss;
}

// If run directly, start on PORT
if (require.main === module) {
  const port = process.env.PORT || 8080;
  const wss = createServer(port);
  console.log(`Relay server listening on port ${port}`);
} else {
  module.exports = { createServer };
}
