import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import passport from './config/passport.js';
import authRoutes from './routes/authRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import { events, eventPolls } from './controllers/eventController.js';
import multer from 'multer';
import path from 'path';
import WebRTCHandler from './webrtc-handler.js';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// In-memory storage for teaching sessions and gaming rooms
const teachingSessions = new Map();
const gamingRooms = new Map();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// Initialize WebRTC Handler
const webRTCHandler = new WebRTCHandler(io);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🎮 BACKEND: ✅ New socket connection:', socket.id);
  
  // WebRTC Signaling
  socket.on('webrtc-signal', (data) => {
    console.log(`Relaying WebRTC signal from ${socket.id} to ${data.to}`);
    io.to(data.to).emit('webrtc-signal', {
      signal: data.signal,
      from: socket.id
    });
  });

  socket.on('create-room', ({ roomId, host }) => {
    console.log('Creating room:', roomId, 'for host:', host);
    socket.join(roomId);
    
    // Check if it's a gaming room
    if (roomId.startsWith('GAME-')) {
      // Check if room already exists (reconnection)
      let existingRoom = gamingRooms.get(roomId);
      if (existingRoom) {
        // Update host socket ID for reconnection
        existingRoom.hostSocketId = socket.id;
        console.log('Gaming room reconnected:', roomId);
      } else {
        const roomData = {
          host,
          hostSocketId: socket.id,
          participants: [],
          messages: [],
          createdAt: new Date(),
          type: 'gaming'
        };
        gamingRooms.set(roomId, roomData);
        console.log('Gaming room created:', roomId);
      }
    } else if (roomId.startsWith('EVENT-')) {
      // Handle event room creation
      const event = events.get(roomId);
      if (event) {
        event.host.socketId = socket.id;
        event.status = 'active';
        event.startedAt = new Date();
        console.log('Event room activated:', roomId);
      } else {
        console.log('Event not found for room creation:', roomId);
      }
    } else {
      const roomData = {
        host,
        hostSocketId: socket.id,
        students: [],
        messages: [],
        notes: [],
        attendance: [],
        feedback: [],
        createdAt: new Date(),
        type: 'teaching'
      };
      teachingSessions.set(roomId, roomData);
    }
    
    socket.emit('room-created', { roomId, success: true });
    console.log('Room created successfully:', roomId);
    console.log('Active gaming rooms:', Array.from(gamingRooms.keys()));
  });

  socket.on('join-room', (roomId, userData) => {
    console.log('🎮 BACKEND: User joining room:', roomId, 'Socket ID:', socket.id);
    console.log('🎮 BACKEND: User data:', userData);
    
    // Handle both old format (roomId only) and new format (roomId, userData)
    const actualRoomId = typeof roomId === 'string' ? roomId : roomId;
    
    // Get current room members before joining
    const roomMembers = io.sockets.adapter.rooms.get(actualRoomId);
    const currentMemberCount = roomMembers ? roomMembers.size : 0;
    console.log('🎮 BACKEND: Current members in room before join:', currentMemberCount);
    
    socket.join(actualRoomId);
    console.log('🎮 BACKEND: ✅ User joined room successfully');
    
    // Get updated room members after joining
    const updatedRoomMembers = io.sockets.adapter.rooms.get(actualRoomId);
    const updatedMemberCount = updatedRoomMembers ? updatedRoomMembers.size : 0;
    console.log('🎮 BACKEND: Updated members in room after join:', updatedMemberCount);
    
    // Notify other users in the room that a new user has connected
    console.log('🎮 BACKEND: Notifying other users about new connection...');
    socket.to(actualRoomId).emit('user-connected', socket.id);
    
    // Send confirmation back to the user
    socket.emit('room-joined', { roomId: actualRoomId, success: true, memberCount: updatedMemberCount });
    
    console.log('🎮 BACKEND: ✅ Notification sent to room about new user:', socket.id);
    console.log('🎮 BACKEND: Room', actualRoomId, 'now has', updatedMemberCount, 'members');
  });

  // WebRTC Signaling - using the same pattern as working audio video
  socket.on('offer', (userId, offer) => {
    console.log('🎮 BACKEND: 📤 Relaying OFFER from', socket.id, 'to', userId);
    io.to(userId).emit('offer', socket.id, offer);
    console.log('🎮 BACKEND: ✅ Offer relayed successfully');
  });

  socket.on('answer', (userId, answer) => {
    console.log('🎮 BACKEND: 📥 Relaying ANSWER from', socket.id, 'to', userId);
    io.to(userId).emit('answer', socket.id, answer);
    console.log('🎮 BACKEND: ✅ Answer relayed successfully');
  });

  socket.on('ice-candidate', (userId, candidate) => {
    console.log('🎮 BACKEND: 🧊 Relaying ICE CANDIDATE from', socket.id, 'to', userId);
    io.to(userId).emit('ice-candidate', socket.id, candidate);
    console.log('🎮 BACKEND: ✅ ICE candidate relayed successfully');
  });
  
  socket.on('join-room-old', (data) => {
    const roomId = typeof data === 'string' ? data : data.roomId;
    const student = typeof data === 'string' ? { name: 'User', avatar: 'U' } : data.student;
    console.log('User requesting to join room:', roomId, 'User:', student.name);
    
    // Check if it's an event room
    if (roomId.startsWith('EVENT-')) {
      const event = events.get(roomId);
      
      if (event && event.status === 'active') {
        socket.join(roomId);
        
        const attendee = {
          id: socket.id,
          name: student.name,
          email: student.email || '',
          avatar: student.avatar || student.name.charAt(0).toUpperCase(),
          socketId: socket.id,
          handRaised: false,
          status: 'online',
          joinTime: new Date()
        };
        
        event.attendees.push(attendee);
        
        // Notify host about new attendee
        io.to(roomId).emit('attendee-joined', attendee);
        console.log('Attendee added to event:', attendee.name, 'Total attendees:', event.attendees.length);
        
        // Send event data to attendee
        socket.emit('event-joined', {
          eventId: roomId,
          event: {
            title: event.title,
            description: event.description,
            host: event.host.name,
            attendees: event.attendees,
            documents: event.documents,
            settings: event.settings
          },
          success: true
        });
        
        console.log('User joined event:', student.name);
      } else {
        console.log('Event not found or not active:', roomId);
        socket.emit('event-not-found', { roomId });
      }
    } else if (roomId.startsWith('GAME-')) {
      const gamingRoom = gamingRooms.get(roomId);
      
      if (gamingRoom) {
        socket.join(roomId);
        
        const participant = {
          id: socket.id,
          name: student.name,
          avatar: student.avatar,
          socketId: socket.id,
          audio: true,
          video: true,
          screenshare: false,
          joinTime: new Date()
        };
        
        // Check if participant already exists
        const existingIndex = gamingRoom.participants.findIndex(p => p.name === student.name);
        if (existingIndex !== -1) {
          gamingRoom.participants[existingIndex] = participant;
        } else {
          gamingRoom.participants.push(participant);
        }
        
        // Notify other users in the room that a new user has connected
        socket.to(roomId).emit('user-connected', socket.id);
        
        // Confirm successful join to the new participant
        socket.emit('room-joined', {
          roomId,
          hostId: gamingRoom.hostSocketId,
          participants: gamingRoom.participants.filter(p => p.id !== socket.id),
          success: true
        });
        
        console.log('User joined gaming room:', student.name, 'Total participants:', gamingRoom.participants.length);
      } else {
        console.log('Gaming room not found:', roomId);
        socket.emit('room-not-found', { roomId });
      }
    } else {
      // Handle teaching room join (existing logic)
      const session = teachingSessions.get(roomId);
      
      if (session) {
        // Create join request
        const joinRequest = {
          id: socket.id,
          student: { ...student, socketId: socket.id },
          roomId,
          timestamp: new Date().toISOString()
        };
        
        // Send join request to teacher
        io.to(session.hostSocketId).emit('join-request', joinRequest);
        
        // Send waiting response to student
        socket.emit('join-pending', { roomId, message: 'Waiting for teacher approval...' });
        
        console.log('Join request sent to teacher for:', student.name);
      } else {
        console.log('Room not found:', roomId);
        socket.emit('room-not-found', { roomId });
      }
    }
  });
  
  socket.on('approve-join', ({ requestId, roomId }) => {
    console.log('Teacher approved join request:', requestId);
    const session = teachingSessions.get(roomId);
    
    if (session) {
      // Notify student of approval
      io.to(requestId).emit('join-approved', { roomId, hostId: session.hostSocketId });
      
      // Add student to room (will be handled when student receives approval)
    }
  });
  
  socket.on('reject-join', ({ requestId, roomId }) => {
    console.log('Teacher rejected join request:', requestId);
    io.to(requestId).emit('join-rejected', { roomId, reason: 'Teacher declined your request' });
  });
  
  socket.on('confirm-join', ({ roomId, student }) => {
    console.log('Student confirming join after approval:', student.name);
    const session = teachingSessions.get(roomId);
    
    if (session) {
      // Check if student already exists by ID or socketId
      const existingIndex = session.students.findIndex(s => s.id === student.id || s.socketId === socket.id);
      if (existingIndex !== -1) {
        console.log('Student already in room, updating socket ID');
        session.students[existingIndex].socketId = socket.id;
        socket.join(roomId);
        socket.emit('room-joined', {
          roomId,
          hostId: session.hostSocketId,
          students: session.students,
          success: true
        });
        return;
      }
      
      socket.join(roomId);
      
      const studentWithSocket = { ...student, socketId: socket.id };
      session.students.push(studentWithSocket);
      
      // Notify teacher about new student
      socket.to(roomId).emit('student-joined', studentWithSocket);
      
      // Confirm successful join
      socket.emit('room-joined', {
        roomId,
        hostId: session.hostSocketId,
        students: session.students,
        success: true
      });
    }
  });
  
  socket.on('mark-attendance', ({ roomId, student }) => {
    console.log('Student marking attendance:', student.name);
    const session = teachingSessions.get(roomId);
    
    if (session) {
      // Check if attendance already marked
      const existingAttendance = session.attendance.find(a => a.studentId === student.id);
      if (!existingAttendance) {
        session.attendance.push({
          studentId: student.id,
          studentName: student.name,
          studentEmail: student.email,
          joinTime: new Date(),
          present: true
        });
        
        // Notify teacher about attendance update
        socket.to(roomId).emit('attendance-marked', {
          studentId: student.id,
          studentName: student.name,
          studentEmail: student.email,
          joinTime: new Date(),
          present: true
        });
      }
    }
  });

  socket.on('disconnecting', () => {
    console.log('🎮 BACKEND: User disconnecting:', socket.id);
    const rooms = Array.from(socket.rooms);
    console.log('🎮 BACKEND: User was in rooms:', rooms);
    
    if (rooms.length > 1) {
      const room = rooms[1]; // First room is always the socket's own ID
      console.log('🎮 BACKEND: Notifying room', room, 'about disconnection');
      socket.to(room).emit('user-disconnected', socket.id);
      console.log('🎮 BACKEND: ✅ Disconnection notification sent');
    }
  });

  socket.on('disconnect', () => {
    console.log('🎮 BACKEND: ❌ User disconnected:', socket.id);
    
    // Check teaching sessions
    let hostRoomId = null;
    teachingSessions.forEach((session, roomId) => {
      if (session.hostSocketId === socket.id) {
        hostRoomId = roomId;
      }
    });
    
    if (hostRoomId) {
      console.log('Host disconnected, keeping room active:', hostRoomId);
      const session = teachingSessions.get(hostRoomId);
      if (session) {
        session.hostActive = false;
      }
    } else {
      // Handle student disconnect
      teachingSessions.forEach((session, roomId) => {
        const studentIndex = session.students.findIndex(s => s.socketId === socket.id);
        if (studentIndex !== -1) {
          const student = session.students[studentIndex];
          session.students.splice(studentIndex, 1);
          console.log('Student left room:', roomId, 'Remaining students:', session.students.length);
          
          // Notify about student leaving
          socket.to(roomId).emit('student-left', student.id);
        }
      });
    }
  });

  socket.on('raise-hand', ({ roomId, studentId }) => {
    socket.to(roomId).emit('hand-raised', studentId);
  });

  socket.on('lower-hand', ({ roomId, studentId }) => {
    socket.to(roomId).emit('hand-lowered', studentId);
  });

  socket.on('toggle-audio', ({ roomId, studentId, muted }) => {
    socket.to(roomId).emit('audio-toggled', { studentId, muted });
  });

  socket.on('toggle-video', ({ roomId, studentId, videoOff }) => {
    socket.to(roomId).emit('video-toggled', { studentId, videoOff });
  });



  socket.on('whiteboard-draw', (data) => {
    socket.to(data.roomId).emit('whiteboard-draw', data);
  });

  socket.on('whiteboard-clear', ({ roomId }) => {
    socket.to(roomId).emit('whiteboard-clear');
  });

  socket.on('open-whiteboard', ({ roomId }) => {
    console.log('Opening whiteboard for room:', roomId);
    socket.to(roomId).emit('whiteboard-opened');
  });

  socket.on('close-whiteboard', ({ roomId }) => {
    console.log('Closing whiteboard for room:', roomId);
    socket.to(roomId).emit('whiteboard-closed');
  });

  socket.on('mute-all', ({ roomId }) => {
    console.log('Muting all students in room:', roomId);
    socket.to(roomId).emit('mute-all');
  });

  socket.on('whiteboard-state', ({ roomId, data }) => {
    socket.to(roomId).emit('whiteboard-state', data);
  });

  socket.on('send-message', ({ roomId, message }) => {
    console.log('Broadcasting message to room:', roomId, message);
    
    // Check if it's a gaming room or teaching session
    const gamingRoom = gamingRooms.get(roomId);
    const session = teachingSessions.get(roomId);
    
    if (gamingRoom) {
      gamingRoom.messages.push(message);
    } else if (session) {
      session.messages.push(message);
    }
    
    io.to(roomId).emit('message', message);
  });

  socket.on('start-screen-share', ({ roomId, teacherId, streamData }) => {
    console.log('Screen share started in room:', roomId, 'by teacher:', teacherId);
    socket.to(roomId).emit('screen-share-started', { 
      teacherId, 
      streamData,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('stop-screen-share', ({ roomId, teacherId }) => {
    console.log('Screen share stopped in room:', roomId, 'by teacher:', teacherId);
    socket.to(roomId).emit('screen-share-stopped', { 
      teacherId,
      timestamp: new Date().toISOString()
    });
  });

  // Gaming specific screen share events
  socket.on('screen-share-started', ({ roomId, userId }) => {
    console.log('Screen share started in gaming room:', roomId, 'by user:', userId);
    socket.to(roomId).emit('screen-share-started', { 
      userId,
      fromUserId: socket.id,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('screen-share-stopped', ({ roomId, userId }) => {
    console.log('Screen share stopped in gaming room:', roomId, 'by user:', userId);
    socket.to(roomId).emit('screen-share-stopped', { 
      userId,
      fromUserId: socket.id,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('start-test', ({ roomId, test }) => {
    socket.to(roomId).emit('test-started', test);
  });

  socket.on('upload-note', ({ roomId, note }) => {
    const session = teachingSessions.get(roomId);
    if (session) {
      session.notes.push(note);
      socket.to(roomId).emit('notes-shared', note);
    }
  });

  socket.on('submit-test', ({ roomId, result }) => {
    const session = teachingSessions.get(roomId);
    if (session) {
      if (!session.testResults) session.testResults = [];
      session.testResults.push(result);
      io.to(roomId).emit('leaderboard-updated', session.testResults);
    }
  });



  socket.on('submit-feedback', ({ roomId, feedback }) => {
    const session = teachingSessions.get(roomId);
    if (session) {
      session.feedback.push(feedback);
    }
  });

  socket.on('end-session', (roomId) => {
    socket.to(roomId).emit('session-ended');
  });

  // Event-specific handlers
  socket.on('event-raise-hand', ({ eventId, attendeeId }) => {
    const event = events.get(eventId);
    if (event) {
      const attendee = event.attendees.find(a => a.id === attendeeId);
      if (attendee) {
        attendee.handRaised = !attendee.handRaised;
        socket.to(eventId).emit('event-hand-raised', { attendeeId, handRaised: attendee.handRaised });
      }
    }
  });

  socket.on('event-toggle-chat', ({ eventId, enabled }) => {
    const event = events.get(eventId);
    if (event) {
      event.settings.chatEnabled = enabled;
      socket.to(eventId).emit('event-chat-toggled', { enabled });
    }
  });

  socket.on('event-send-message', ({ eventId, message }) => {
    const event = events.get(eventId);
    if (event && event.settings.chatEnabled) {
      event.messages.push(message);
      io.to(eventId).emit('event-message', message);
    }
  });

  socket.on('event-start-poll', ({ eventId, poll }) => {
    const event = events.get(eventId);
    if (event) {
      const pollWithId = { ...poll, id: `POLL-${Date.now()}`, eventId, status: 'active', votes: {} };
      eventPolls.set(pollWithId.id, pollWithId);
      event.polls.push(pollWithId);
      socket.to(eventId).emit('event-poll-started', pollWithId);
      
      // Auto-close poll after duration
      setTimeout(() => {
        const pollToClose = eventPolls.get(pollWithId.id);
        if (pollToClose && pollToClose.status === 'active') {
          pollToClose.status = 'closed';
          socket.to(eventId).emit('event-poll-ended', pollWithId.id);
        }
      }, (poll.duration || 60) * 1000);
    }
  });

  socket.on('event-vote-poll', ({ pollId, optionId, userId }) => {
    const poll = eventPolls.get(pollId);
    if (poll && poll.status === 'active') {
      if (!poll.votes[userId]) {
        poll.votes[userId] = optionId;
        const event = events.get(poll.eventId);
        if (event) {
          socket.to(poll.eventId).emit('event-poll-vote', { pollId, optionId, userId });
        }
      }
    }
  });

  socket.on('event-share-document', ({ eventId, document }) => {
    const event = events.get(eventId);
    if (event) {
      event.documents.push(document);
      socket.to(eventId).emit('event-document-shared', document);
    }
  });

  socket.on('event-end', ({ eventId }) => {
    const event = events.get(eventId);
    if (event) {
      event.status = 'ended';
      event.endedAt = new Date();
      socket.to(eventId).emit('event-ended');
    }
  });

  socket.on('end-meeting', ({ roomId }) => {
    console.log('Host ending meeting for room:', roomId);
    socket.to(roomId).emit('host-ended-meeting');
  });

  socket.on('sync-participants', ({ roomId, participants, total }) => {
    console.log('Syncing participants for room:', roomId, 'Total:', total);
    socket.to(roomId).emit('participants-update', { participants, total });
  });

  socket.on('share-user-info', ({ roomId, userId, name, isHost }) => {
    console.log('Sharing user info for room:', roomId, 'User:', name, 'IsHost:', isHost);
    socket.to(roomId).emit('user-info-shared', { userId, name, isHost });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);

// File upload endpoint
app.post('/api/upload-note', upload.single('note'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const fileInfo = {
    id: Date.now().toString(),
    name: req.file.originalname,
    filename: req.file.filename,
    size: req.file.size,
    uploadTime: new Date().toLocaleString(),
    downloadUrl: `/uploads/${req.file.filename}`
  };
  
  res.json(fileInfo);
});

// Get session data endpoints
app.get('/api/session/:roomId/attendance', (req, res) => {
  const session = teachingSessions.get(req.params.roomId);
  res.json(session ? session.attendance : []);
});

app.get('/api/session/:roomId/feedback', (req, res) => {
  const session = teachingSessions.get(req.params.roomId);
  res.json(session ? session.feedback : []);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ message: 'Server is running with Teaching Zone' });
});

// Debug endpoint to check active rooms
app.get('/api/rooms', (req, res) => {
  const teachingRooms = Array.from(teachingSessions.entries()).map(([roomId, session]) => ({
    roomId,
    host: session.host,
    studentCount: session.students.length,
    createdAt: session.createdAt,
    hostActive: session.hostActive !== false,
    type: 'teaching'
  }));
  
  const gameRooms = Array.from(gamingRooms.entries()).map(([roomId, room]) => ({
    roomId,
    host: room.host,
    participantCount: room.participants.length,
    createdAt: room.createdAt,
    type: 'gaming'
  }));
  
  res.json({ 
    teachingRooms, 
    gameRooms,
    totalTeachingRooms: teachingSessions.size,
    totalGamingRooms: gamingRooms.size
  });
});

// Handle incorrect Google OAuth redirect - remove this as it's handled by authRoutes
// app.get('/auth/success', (req, res) => {
//   const { token, name, email } = req.query;
//   const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
//   res.redirect(`${frontendUrl}/auth/success?token=${token}&name=${name}&email=${email}`);
// });

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});