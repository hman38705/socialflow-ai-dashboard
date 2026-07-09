import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import { createLogger } from '../lib/logger';

const logger = createLogger('AudioMerger');

export class AudioMerger {
  /**
   * Concatenate multiple MP3 files into a single output file.
   * Uses ffmpeg concat demuxer for gapless joining.
   */
  async mergeAudioFiles(inputPaths: string[], outputPath: string): Promise<void> {
    if (inputPaths.length === 0) throw new Error('No audio files to merge');

    // Single file — just copy it
    if (inputPaths.length === 1) {
      await fs.copyFile(inputPaths[0], outputPath);
      return;
    }

    // Write a concat list file for ffmpeg
    const listPath = outputPath + '.concat.txt';
    const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    await fs.writeFile(listPath, listContent, 'utf8');

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .on('start', (cmd: string) => logger.info('Merging audio', { cmd }))
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(outputPath);
    });

    await fs.unlink(listPath).catch(() => {});
    logger.info(`Audio merged`, { outputPath, segments: inputPaths.length });
  }

  /**
   * Merge a narration audio track into a video file.
   * The narration replaces (or mixes with) the existing audio.
   *
   * @param videoPath   Source video file
   * @param audioPath   Narration MP3
   * @param outputPath  Output MP4
   * @param mixWithOriginal  If true, mix narration with original audio; otherwise replace
   */
  async mergeAudioIntoVideo(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    mixWithOriginal = false,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(videoPath).input(audioPath);

      if (mixWithOriginal) {
        // Mix original + narration with amerge
        cmd
          .complexFilter(['[0:a][1:a]amerge=inputs=2[aout]'])
          .outputOptions([
            '-map',
            '0:v',
            '-map',
            '[aout]',
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-ac',
            '2',
            '-shortest',
          ]);
      } else {
        // Replace audio entirely
        cmd.outputOptions([
          '-map',
          '0:v',
          '-map',
          '1:a',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-shortest',
        ]);
      }

      cmd
        .on('start', (c: string) => logger.info('Merging narration into video', { cmd: c }))
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(outputPath);
    });

    logger.info(`Video with narration saved`, { outputPath });
  }
}

export const audioMerger = new AudioMerger();
