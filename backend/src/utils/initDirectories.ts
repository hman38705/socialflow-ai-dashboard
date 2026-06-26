import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../lib/logger';
import { videoConfig } from '../config/video.config';

const logger = createLogger('initDirectories');

/**
 * Initialize required directories for the application
 */
export async function initDirectories(): Promise<void> {
  const directories = [
    path.join(process.cwd(), videoConfig.upload.uploadDir),
    path.join(process.cwd(), videoConfig.upload.transcodedDir),
    path.join(process.cwd(), 'uploads', 'tts'),
  ];

  for (const dir of directories) {
    try {
      await fs.mkdir(dir, { recursive: true });
      logger.info(`Directory ensured: ${dir}`);
    } catch (error) {
      logger.error(`Failed to create directory ${dir}`, { error });
      throw error;
    }
  }
}
