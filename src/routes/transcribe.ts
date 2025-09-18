import { Router } from 'express';
import { MediaProcessorService } from '../services/transcriber';
import path from 'path';
import fs from 'fs';
import os from 'os';

const router = Router();
const mediaProcessor = new MediaProcessorService();
const TEMP_DIR = path.join(os.tmpdir(), 'media-transcriber');

router.post('/', async (req, res) => {
  console.log('Received transcription request:', req.body);
  const { filePath } = req.body;
  
  if (!filePath) {
    console.log('No file path provided');
    return res.status(400).json({ error: 'No file selected' });
  }
  
  try {
    console.log('Attempting to transcribe file:', filePath);
    
    // Handle both relative paths (temp_resources/...) and absolute paths
    let fullPath: string;
    
    if (filePath.startsWith('temp_resources/')) {
      // This is a relative path from the frontend
      const relativePath = filePath.replace('temp_resources/', '');
      fullPath = path.join(TEMP_DIR, relativePath);
    } else if (path.isAbsolute(filePath)) {
      // Already an absolute path
      fullPath = filePath;
    } else {
      // Some other relative path
      fullPath = path.join(process.cwd(), filePath);
    }
    
    console.log('Full path:', fullPath);
    
    if (!fs.existsSync(fullPath)) {
      console.log('File not found, checking directory contents:');
      const dir = path.dirname(fullPath);
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach(file => {
          console.log(path.join(dir, file));
        });
      } else {
        console.log(`Directory ${dir} does not exist`);
      }
      return res.status(404).json({ error: `File not found: ${fullPath}` });
    }
    
    const transcription = await mediaProcessor.transcribe(fullPath);
    const duration = await mediaProcessor.getAudioDuration(fullPath);
    
    console.log('Transcription successful');
    res.json({ 
      transcription,
      duration: duration ? Math.round(duration * 100) / 100 : null
    });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export { router as transcribeRoute };