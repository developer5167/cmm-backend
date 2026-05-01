const jwt = require('jsonwebtoken');
const { query } = require('../db');

class SocketService {
  constructor(io) {
    this.io = io;
    this.users = new Map(); // userId -> Set of socketIds
    this.initialize();
  }

  initialize() {
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error: Token missing'));
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.userId;
        next();
      } catch (err) {
        next(new Error('Authentication error: Invalid token'));
      }
    });

    this.io.on('connection', async (socket) => {
      const userId = socket.userId;

      if (!this.users.has(userId)) {
        this.users.set(userId, new Set());
      }
      this.users.get(userId).add(socket.id);

      console.log(`📡 Socket connected: ${socket.id} (User: ${userId})`);

      // Notify conversation partners that this user is now online
      this._notifyPartners(userId, 'user_online', { user_id: userId });

      socket.on('disconnect', async () => {
        const userSockets = this.users.get(userId);
        if (userSockets) {
          userSockets.delete(socket.id);

          if (userSockets.size === 0) {
            this.users.delete(userId);

            // Persist last_seen_at
            const now = new Date();
            try {
              await query(
                'UPDATE users SET last_seen_at = $1 WHERE id = $2',
                [now, userId]
              );
            } catch (err) {
              console.warn('⚠️ Could not update last_seen_at:', err.message);
            }

            // Notify partners the user went offline
            this._notifyPartners(userId, 'user_offline', {
              user_id: userId,
              last_seen_at: now.toISOString(),
            });
          }
        }
        console.log(`📡 Socket disconnected: ${socket.id}`);
      });
    });
  }

  /** Emit an event to all conversation partners of userId */
  async _notifyPartners(userId, event, data) {
    try {
      const result = await query(
        `SELECT CASE WHEN user1_id = $1 THEN user2_id ELSE user1_id END AS partner_id
         FROM conversations WHERE user1_id = $1 OR user2_id = $1`,
        [userId]
      );
      result.rows.forEach(({ partner_id }) => {
        this.emitToUser(partner_id, event, data);
      });
    } catch (err) {
      console.warn(`⚠️ _notifyPartners (${event}) failed:`, err.message);
    }
  }

  /** Returns true if the user has at least one active socket */
  isOnline(userId) {
    return this.users.has(userId) && this.users.get(userId).size > 0;
  }

  /** Send event to a specific user (all their devices) */
  emitToUser(userId, event, data) {
    const socketIds = this.users.get(userId);
    if (socketIds && socketIds.size > 0) {
      socketIds.forEach((sid) => this.io.to(sid).emit(event, data));
      return true;
    }
    return false;
  }

  broadcast(event, data) {
    this.io.emit(event, data);
  }
}

let instance = null;

const init = (io) => {
  if (!instance) instance = new SocketService(io);
  return instance;
};

const getInstance = () => {
  if (!instance) throw new Error('SocketService not initialized');
  return instance;
};

module.exports = { init, getInstance };
