import express from 'express';
import { 
  createEvent, 
  getEvent, 
  uploadDocument, 
  createPoll, 
  votePoll, 
  getEventStats,
  upload 
} from '../controllers/eventController.js';

const router = express.Router();

// Event management routes
router.post('/create', createEvent);
router.get('/:eventId', getEvent);
router.get('/stats/overview', getEventStats);

// Document management
router.post('/:eventId/documents', upload.single('document'), uploadDocument);

// Poll management
router.post('/:eventId/polls', createPoll);
router.post('/polls/:pollId/vote', votePoll);

export default router;