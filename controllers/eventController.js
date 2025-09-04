import multer from 'multer';
import path from 'path';

// File upload configuration for events
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/events/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

export const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|ppt|pptx|txt|zip/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// In-memory storage for events
const events = new Map();
const eventPolls = new Map();

export const createEvent = (req, res) => {
  try {
    const { title, description, hostName, hostEmail } = req.body;
    const eventId = `EVENT-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    const event = {
      id: eventId,
      title: title || 'Untitled Event',
      description: description || '',
      host: {
        name: hostName,
        email: hostEmail,
        socketId: null
      },
      attendees: [],
      messages: [],
      documents: [],
      polls: [],
      settings: {
        chatEnabled: true,
        handsEnabled: true,
        documentsEnabled: true,
        pollsEnabled: true
      },
      status: 'created',
      createdAt: new Date(),
      startedAt: null
    };
    
    events.set(eventId, event);
    
    res.json({
      success: true,
      eventId,
      shareLink: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/events/join/${eventId}`
    });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ success: false, message: 'Failed to create event' });
  }
};

export const getEvent = (req, res) => {
  try {
    const { eventId } = req.params;
    const event = events.get(eventId);
    
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    
    res.json({ success: true, event });
  } catch (error) {
    console.error('Error getting event:', error);
    res.status(500).json({ success: false, message: 'Failed to get event' });
  }
};

export const uploadDocument = (req, res) => {
  try {
    const { eventId } = req.params;
    const event = events.get(eventId);
    
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    const document = {
      id: Date.now().toString(),
      name: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      type: req.file.mimetype,
      uploadTime: new Date(),
      downloadUrl: `/uploads/events/${req.file.filename}`
    };
    
    event.documents.push(document);
    
    res.json({ success: true, document });
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ success: false, message: 'Failed to upload document' });
  }
};

export const createPoll = (req, res) => {
  try {
    const { eventId } = req.params;
    const { question, options, duration } = req.body;
    
    const event = events.get(eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    
    const pollId = `POLL-${Date.now()}`;
    const poll = {
      id: pollId,
      eventId,
      question,
      options: options.map((option, index) => ({
        id: index,
        text: option,
        votes: 0,
        voters: []
      })),
      duration: duration || 60, // seconds
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + (duration || 60) * 1000),
      status: 'active',
      totalVotes: 0
    };
    
    eventPolls.set(pollId, poll);
    event.polls.push(poll);
    
    // Auto-close poll after duration
    setTimeout(() => {
      const pollToClose = eventPolls.get(pollId);
      if (pollToClose && pollToClose.status === 'active') {
        pollToClose.status = 'closed';
      }
    }, (duration || 60) * 1000);
    
    res.json({ success: true, poll });
  } catch (error) {
    console.error('Error creating poll:', error);
    res.status(500).json({ success: false, message: 'Failed to create poll' });
  }
};

export const votePoll = (req, res) => {
  try {
    const { pollId } = req.params;
    const { optionId, userId } = req.body;
    
    const poll = eventPolls.get(pollId);
    if (!poll) {
      return res.status(404).json({ success: false, message: 'Poll not found' });
    }
    
    if (poll.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Poll is not active' });
    }
    
    // Check if user already voted
    const hasVoted = poll.options.some(option => option.voters.includes(userId));
    if (hasVoted) {
      return res.status(400).json({ success: false, message: 'User already voted' });
    }
    
    // Add vote
    const option = poll.options.find(opt => opt.id === optionId);
    if (!option) {
      return res.status(400).json({ success: false, message: 'Invalid option' });
    }
    
    option.votes++;
    option.voters.push(userId);
    poll.totalVotes++;
    
    res.json({ success: true, poll });
  } catch (error) {
    console.error('Error voting on poll:', error);
    res.status(500).json({ success: false, message: 'Failed to vote' });
  }
};

export const getEventStats = (req, res) => {
  try {
    const totalEvents = events.size;
    const activeEvents = Array.from(events.values()).filter(e => e.status === 'active').length;
    const totalAttendees = Array.from(events.values()).reduce((sum, e) => sum + e.attendees.length, 0);
    
    res.json({
      success: true,
      stats: {
        totalEvents,
        activeEvents,
        totalAttendees,
        totalPolls: eventPolls.size
      }
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ success: false, message: 'Failed to get stats' });
  }
};

// Export the events map for socket handlers
export { events, eventPolls };