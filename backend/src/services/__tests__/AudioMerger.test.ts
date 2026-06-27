import { audioMerger, AudioMerger } from '../AudioMerger';
import fs from 'fs/promises';

jest.mock('fluent-ffmpeg', () => {
  const mock = jest.fn();
  return mock;
});

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

function makeFfmpegChain(): Record<string, jest.Mock> {
  return {
    input: jest.fn().mockReturnThis(),
    inputOptions: jest.fn().mockReturnThis(),
    audioCodec: jest.fn().mockReturnThis(),
    audioBitrate: jest.fn().mockReturnThis(),
    outputOptions: jest.fn().mockReturnThis(),
    complexFilter: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    save: jest.fn().mockReturnThis(),
  };
}

describe('AudioMerger', () => {
  let merger: AudioMerger;
  let ffmpegMock: jest.Mock;

  beforeEach(() => {
    merger = audioMerger;
    jest.clearAllMocks();
    ffmpegMock = require('fluent-ffmpeg') as jest.Mock;
  });

  describe('mergeAudioFiles', () => {
    it('should throw an error when inputPaths is empty', async () => {
      await expect(merger.mergeAudioFiles([], '/out/merged.mp3')).rejects.toThrow(
        'No audio files to merge',
      );
    });

    it('should copy the file directly when only one input is provided', async () => {
      const spy = jest.spyOn(fs, 'copyFile').mockResolvedValue(undefined);

      await merger.mergeAudioFiles(['/in/single.mp3'], '/out/single.mp3');

      expect(spy).toHaveBeenCalledWith('/in/single.mp3', '/out/single.mp3');
      expect(ffmpegMock).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should merge multiple files using ffmpeg concat demuxer', async () => {
      jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

      const chain = makeFfmpegChain();
      chain.on.mockImplementation((event: string, cb: Function) => {
        if (event === 'end') setImmediate(cb);
        return chain;
      });
      ffmpegMock.mockReturnValue(chain);

      await merger.mergeAudioFiles(['/in/a.mp3', '/in/b.mp3', '/in/c.mp3'], '/out/merged.mp3');

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/out/merged.mp3.concat.txt',
        expect.stringContaining("file '/in/a.mp3'"),
        'utf8',
      );
      expect(ffmpegMock).toHaveBeenCalledTimes(1);
      jest.restoreAllMocks();
    });

    it('should clean up the concat list file after merging', async () => {
      jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      const unlinkSpy = jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

      const chain = makeFfmpegChain();
      chain.on.mockImplementation((event: string, cb: Function) => {
        if (event === 'end') setImmediate(cb);
        return chain;
      });
      ffmpegMock.mockReturnValue(chain);

      await merger.mergeAudioFiles(['/in/a.mp3', '/in/b.mp3'], '/out/merged.mp3');

      expect(unlinkSpy).toHaveBeenCalledWith('/out/merged.mp3.concat.txt');
      jest.restoreAllMocks();
    });

    it('should not throw when cleanup of concat file fails', async () => {
      jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fs, 'unlink').mockRejectedValue(new Error('cleanup error'));

      const chain = makeFfmpegChain();
      chain.on.mockImplementation((event: string, cb: Function) => {
        if (event === 'end') setImmediate(cb);
        return chain;
      });
      ffmpegMock.mockReturnValue(chain);

      await expect(
        merger.mergeAudioFiles(['/in/a.mp3', '/in/b.mp3'], '/out/merged.mp3'),
      ).resolves.toBeUndefined();
      jest.restoreAllMocks();
    });

    it('should escape single quotes in file paths for concat list', async () => {
      const writeSpy = jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

      const chain = makeFfmpegChain();
      chain.on.mockImplementation((event: string, cb: Function) => {
        if (event === 'end') setImmediate(cb);
        return chain;
      });
      ffmpegMock.mockReturnValue(chain);

      await merger.mergeAudioFiles(["/in/it's.mp3", '/in/other.mp3'], '/out/merged.mp3');

      expect(writeSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("\\'"),
        'utf8',
      );
      jest.restoreAllMocks();
    });
  });

  describe('mergeAudioIntoVideo', () => {
    it('should replace audio by default (mixWithOriginal=false)', async () => {
      const chain = makeFfmpegChain();
      chain.on.mockImplementation((event: string, cb: Function) => {
        if (event === 'end') setImmediate(cb);
        return chain;
      });
      ffmpegMock.mockReturnValue(chain);

      await merger.mergeAudioIntoVideo('/in/video.mp4', '/in/narration.mp3', '/out/output.mp4');

      expect(ffmpegMock).toHaveBeenCalledWith('/in/video.mp4');
      expect(chain.input).toHaveBeenCalledWith('/in/narration.mp3');
      expect(chain.outputOptions).toHaveBeenCalledWith(
        expect.arrayContaining(['-map', '0:v', '-map', '1:a', '-c:v', 'copy']),
      );
    });

    it('should mix audio with original when mixWithOriginal=true', async () => {
      const chain = makeFfmpegChain();
      chain.on.mockImplementation((event: string, cb: Function) => {
        if (event === 'end') setImmediate(cb);
        return chain;
      });
      ffmpegMock.mockReturnValue(chain);

      await merger.mergeAudioIntoVideo(
        '/in/video.mp4',
        '/in/narration.mp3',
        '/out/output.mp4',
        true,
      );

      expect(chain.complexFilter).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('amerge')]),
      );
    });

    it('should use shortest output option to match video duration', async () => {
      const chain = makeFfmpegChain();
      chain.on.mockImplementation((event: string, cb: Function) => {
        if (event === 'end') setImmediate(cb);
        return chain;
      });
      ffmpegMock.mockReturnValue(chain);

      await merger.mergeAudioIntoVideo('/in/video.mp4', '/in/narration.mp3', '/out/output.mp4');

      expect(chain.outputOptions).toHaveBeenCalledWith(
        expect.arrayContaining(['-shortest']),
      );
    });

    it('should reject on ffmpeg error', async () => {
      const chain = makeFfmpegChain();
      chain.on.mockImplementation((event: string, cb: Function) => {
        if (event === 'error') setImmediate(() => cb(new Error('ffmpeg failed')));
        return chain;
      });
      ffmpegMock.mockReturnValue(chain);

      await expect(
        merger.mergeAudioIntoVideo('/in/video.mp4', '/in/narration.mp3', '/out/output.mp4'),
      ).rejects.toThrow('ffmpeg failed');
    });
  });
});
