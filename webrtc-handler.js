// WebRTC Signaling Handler for Socket.IO

export default class WebRTCHandler {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomId -> { host, students, connections }
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('WebRTC: User connected:', socket.id);

      // WebRTC Signaling Events
      socket.on('webrtc-offer', (data) => {
        const { roomId, offer, targetUserId } = data;
        console.log('WebRTC: Forwarding offer from', socket.id, 'to', targetUserId);
        this.io.to(targetUserId).emit('webrtc-offer', {
          offer,
          fromUserId: socket.id
        });
      });

      socket.on('webrtc-answer', (data) => {
        const { roomId, answer, targetUserId } = data;
        console.log('WebRTC: Forwarding answer from', socket.id, 'to', targetUserId);
        this.io.to(targetUserId).emit('webrtc-answer', {
          answer,
          fromUserId: socket.id
        });
      });

      socket.on('webrtc-ice-candidate', (data) => {
        const { roomId, candidate, targetUserId } = data;
        console.log('WebRTC: Forwarding ICE candidate from', socket.id, 'to', targetUserId);
        this.io.to(targetUserId).emit('webrtc-ice-candidate', {
          candidate,
          fromUserId: socket.id
        });
      });

      // Room Management
      socket.on('create-room', (data) => {
        const { roomId, host } = data;
        console.log('WebRTC: Creating room', roomId, 'for host', socket.id);
        
        this.rooms.set(roomId, {
          hostId: socket.id,
          hostName: host,
          students: new Map(),
          connections: new Map()
        });
        
        socket.join(roomId);
        socket.emit('room-created', { roomId, hostId: socket.id });
      });

      socket.on('join-room', (data) => {
        const { roomId, student } = data;
        const room = this.rooms.get(roomId);
        
        if (!room) {
          socket.emit('room-not-found');
          return;
        }

        console.log('WebRTC: Student', socket.id, 'joining room', roomId);
        
        // Add student to room
        room.students.set(socket.id, {
          ...student,
          socketId: socket.id,
          joinTime: new Date()
        });
        
        socket.join(roomId);
        
        // Notify student of successful join
        socket.emit('room-joined', {
          roomId,
          hostId: room.hostId,
          students: Array.from(room.students.values())
        });
        
        // Notify host and other students
        socket.to(roomId).emit('user-joined-webrtc', {
          userId: socket.id,
          userData: student
        });
        
        // Notify host specifically about new student
        this.io.to(room.hostId).emit('student-joined', {
          ...student,
          id: socket.id
        });
      });

      // Screen Sharing Events
      socket.on('screen-share-started', (data) => {
        const { roomId, userId } = data;
        console.log('WebRTC: Screen share started by', userId, 'in room', roomId);
        socket.to(roomId).emit('screen-share-started', {
          userId,
          fromUserId: socket.id
        });
      });

      socket.on('screen-share-stopped', (data) => {
        const { roomId, userId } = data;
        console.log('WebRTC: Screen share stopped by', userId, 'in room', roomId);
        socket.to(roomId).emit('screen-share-stopped', {
          userId,
          fromUserId: socket.id
        });
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log('WebRTC: User disconnected:', socket.id);
        this.handleUserDisconnect(socket.id);
      });

      // Leave room explicitly
      socket.on('leave-room', (data) => {
        const { roomId } = data;
        this.handleUserLeaveRoom(socket.id, roomId);
      });
    });
  }

  handleUserDisconnect(socketId) {
    // Find and clean up user from all rooms
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.hostId === socketId) {
        // Host disconnected - notify all students and clean up room
        this.io.to(roomId).emit('host-disconnected');
        this.rooms.delete(roomId);
        console.log('WebRTC: Room', roomId, 'deleted due to host disconnect');
      } else if (room.students.has(socketId)) {
        // Student disconnected
        room.students.delete(socketId);
        this.io.to(roomId).emit('user-left-webrtc', {
          userId: socketId
        });
        this.io.to(room.hostId).emit('student-left', socketId);
        console.log('WebRTC: Student', socketId, 'left room', roomId);
      }
    }
  }

  handleUserLeaveRoom(socketId, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (room.hostId === socketId) {
      // Host leaving - end session for all
      this.io.to(roomId).emit('session-ended');
      this.rooms.delete(roomId);
    } else if (room.students.has(socketId)) {
      // Student leaving
      room.students.delete(socketId);
      this.io.to(roomId).emit('user-left-webrtc', {
        userId: socketId
      });
      this.io.to(room.hostId).emit('student-left', socketId);
    }
  }

  // Utility methods
  getRoomInfo(roomId) {
    return this.rooms.get(roomId);
  }

  getAllRooms() {
    return Array.from(this.rooms.entries()).map(([roomId, room]) => ({
      roomId,
      hostName: room.hostName,
      studentCount: room.students.size,
      createdAt: room.createdAt
    }));
  }
}

