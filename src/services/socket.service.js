const jwt = require('jsonwebtoken');

/**
 * Socket Service - GraceMatch
 * Handles real-time connections and custom events.
 */
class SocketService {
  constructor(io) {
    this.io = io;
    this.users = new Map(); // userId -> Set of socketIds

    this.initialize();
  }

  initialize() {
    // Middleware for Auth
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error: Token missing'));

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        next();
      } catch (err) {
        next(new Error('Authentication error: Invalid token'));
      }
    });

    this.io.on('connection', (socket) => {
      const userId = socket.userId;
      
      // Map user to socket
      if (!this.users.has(userId)) {
        this.users.set(userId, new Set());
      }
      this.users.get(userId).add(socket.id);

      console.log(`📡 Socket connected: ${socket.id} (User: ${userId})`);

      socket.on('disconnect', () => {
        const userSockets = this.users.get(userId);
        if (userSockets) {
          userSockets.delete(socket.id);
          if (userSockets.size === 0) {
            this.users.delete(userId);
          }
        }
        console.log(`📡 Socket disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Send event to a specific user
   */
  emitToUser(userId, event, data) {
    const socketIds = this.users.get(userId);
    if (socketIds) {
      socketIds.forEach((sid) => {
        this.io.to(sid).emit(event, data);
      });
      return true;
    }
    return false;
  }

  /**
   * Broadcast to all
   */
  broadcast(event, data) {
    this.io.emit(event, data);
  }
}

let instance = null;

const init = (io) => {
  if (!instance) {
    instance = new SocketService(io);
  }
  return instance;
};

const getInstance = () => {
  if (!instance) {
    throw new Error('SocketService not initialized');
  }
  return instance;
};

module.exports = { init, getInstance };
