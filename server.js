import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', online: io.engine.clientsCount });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
});

/** @type {Array<{socketId: string, userName: string, interests: string[], mode: string, joinedAt: number}>} */
const waitingQueue = [];

/** @type {Map<string, {roomId: string, user1: string, user2: string}>} */
const activeRooms = new Map();

/** @type {Map<string, string>} */
const userRooms = new Map();

/** @type {Map<string, NodeJS.Timeout>} */
const disconnectTimers = new Map();

function broadcastOnlineCount() {
  io.emit('online-count', io.engine.clientsCount);
}

function removeFromQueue(socketId) {
  const index = waitingQueue.findIndex((u) => u.socketId === socketId);
  if (index !== -1) {
    waitingQueue.splice(index, 1);
  }
}

function leaveActiveRoom(socketId) {
  const roomId = userRooms.get(socketId);
  if (!roomId) return;

  const room = activeRooms.get(roomId);
  if (room) {
    const partnerId = room.user1 === socketId ? room.user2 : room.user1;
    userRooms.delete(partnerId);
    activeRooms.delete(roomId);

    // Notify partner that peer left
    io.to(partnerId).emit('partner-left');
  }

  userRooms.delete(socketId);
}

function findMatch(user) {
  // Try to find someone with matching interests first
  let matchIndex = -1;
  let sharedInterests = [];

  if (user.interests && user.interests.length > 0) {
    for (let i = 0; i < waitingQueue.length; i++) {
      const candidate = waitingQueue[i];
      if (candidate.socketId === user.socketId) continue;

      const shared = candidate.interests.filter((item) =>
        user.interests.some((ui) => ui.toLowerCase() === item.toLowerCase())
      );

      if (shared.length > 0) {
        matchIndex = i;
        sharedInterests = shared;
        break;
      }
    }
  }

  // If no interest match, match with the first available person in queue
  if (matchIndex === -1 && waitingQueue.length > 0) {
    for (let i = 0; i < waitingQueue.length; i++) {
      if (waitingQueue[i].socketId !== user.socketId) {
        matchIndex = i;
        break;
      }
    }
  }

  if (matchIndex !== -1) {
    const partner = waitingQueue.splice(matchIndex, 1)[0];
    const roomId = `room_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;

    activeRooms.set(roomId, {
      roomId,
      user1: user.socketId,
      user2: partner.socketId,
    });

    userRooms.set(user.socketId, roomId);
    userRooms.set(partner.socketId, roomId);

    // User 1 is initiator (creates SDP Offer)
    io.to(user.socketId).emit('partner-matched', {
      roomId,
      partnerId: partner.socketId,
      partnerName: partner.userName || 'Stranger',
      isInitiator: true,
      sharedInterests,
    });

    // Partner is receiver (creates SDP Answer)
    io.to(partner.socketId).emit('partner-matched', {
      roomId,
      partnerId: user.socketId,
      partnerName: user.userName || 'Stranger',
      isInitiator: false,
      sharedInterests,
    });

    console.log(`[MATCH] Paired ${user.socketId} (${user.userName}) <--> ${partner.socketId} (${partner.userName}) in ${roomId}`);
    return true;
  }

  // No match yet -> add to waiting queue
  waitingQueue.push(user);
  console.log(`[QUEUE] User ${user.socketId} (${user.userName}) joined waiting queue. Queue size: ${waitingQueue.length}`);
  return false;
}

io.on('connection', (socket) => {
  console.log(`[CONNECT] Socket connected: ${socket.id}`);
  broadcastOnlineCount();

  // Find partner / matchmaking request
  socket.on('find-partner', (data) => {
    // Clean up any old state first
    removeFromQueue(socket.id);
    leaveActiveRoom(socket.id);

    const user = {
      socketId: socket.id,
      userName: data?.userName || 'Anonymous',
      interests: data?.interests || [],
      mode: data?.mode || 'video',
      joinedAt: Date.now(),
    };

    findMatch(user);
  });

  // Keep-alive heartbeat (prevents free cloud proxies from idling or dropping WebSockets)
  socket.on('ping-alive', () => {});

  // WebRTC Signaling forwarder (SDP Offer / SDP Answer / ICE Candidates)
  // ONLY handles the initial 1-second handshake keys; after this, all video and chat are 100% P2P
  socket.on('signal', (data) => {
    if (data && data.to) {
      io.to(data.to).emit('signal', {
        from: socket.id,
        signalData: data.signalData,
      });
    }
  });

  // Direct text/typing/reaction message forwarding fallback (ensures 100% message delivery)
  socket.on('chat-message', (data) => {
    if (data && data.to && data.payload) {
      io.to(data.to).emit('chat-message', {
        from: socket.id,
        payload: data.payload,
      });
    }
  });

  // Skip / Next stranger
  socket.on('next-partner', (data) => {
    leaveActiveRoom(socket.id);
    removeFromQueue(socket.id);

    const user = {
      socketId: socket.id,
      userName: data?.userName || 'Anonymous',
      interests: data?.interests || [],
      mode: data?.mode || 'video',
      joinedAt: Date.now(),
    };

    findMatch(user);
  });

  // Stop chatting / Disconnect from session
  socket.on('leave', () => {
    removeFromQueue(socket.id);
    leaveActiveRoom(socket.id);
  });

  // Client disconnect
  socket.on('disconnect', () => {
    console.log(`[DISCONNECT] Socket disconnected: ${socket.id}`);
    removeFromQueue(socket.id);
    leaveActiveRoom(socket.id);
    broadcastOnlineCount();
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Socket.IO P2P Signaling Server running on http://localhost:${PORT}`);
});
