import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from '../../types';
import { MediaAttachment, MediaUploader } from './MediaUploader';

function makeFile(name: string, type: string, sizeBytes: number): File {
  const file = new File([new Uint8Array(sizeBytes)], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

function Harness({
  platform,
  initial = [] as MediaAttachment[],
}: {
  platform: Platform;
  initial?: MediaAttachment[];
}) {
  const [value, setValue] = useState<MediaAttachment[]>(initial);
  return <MediaUploader platform={platform} value={value} onChange={setValue} />;
}

describe('MediaUploader', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('rejects an oversized image before upload starts', () => {
    render(<Harness platform={Platform.TWITTER} />);
    const input = screen.getByLabelText('Add photos or videos').querySelector('input') as HTMLInputElement;
    const oversized = makeFile('big.png', 'image/png', 6 * 1024 * 1024); // > 5MB Twitter limit

    fireEvent.change(input, { target: { files: [oversized] } });

    expect(screen.getByRole('alert')).toHaveTextContent(/allows up to 5MB/);
  });

  it('rejects an unsupported file type before upload starts', () => {
    render(<Harness platform={Platform.TWITTER} />);
    const input = screen.getByLabelText('Add photos or videos').querySelector('input') as HTMLInputElement;
    const badType = makeFile('doc.pdf', 'application/pdf', 1024);

    fireEvent.change(input, { target: { files: [badType] } });

    expect(screen.getByRole('alert')).toHaveTextContent(/Unsupported file type/);
  });

  it('calls URL.revokeObjectURL when a file is removed', () => {
    render(<Harness platform={Platform.TWITTER} />);
    const input = screen.getByLabelText('Add photos or videos').querySelector('input') as HTMLInputElement;
    const valid = makeFile('ok.png', 'image/png', 1024);

    fireEvent.change(input, { target: { files: [valid] } });

    const removeButton = screen.getByRole('button', { name: /remove ok.png/i });
    fireEvent.click(removeButton);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('reorders thumbnails via the keyboard move buttons', () => {
    render(<Harness platform={Platform.TWITTER} />);
    const input = screen.getByLabelText('Add photos or videos').querySelector('input') as HTMLInputElement;
    const first = makeFile('a.png', 'image/png', 1024);
    const second = makeFile('b.png', 'image/png', 1024);

    fireEvent.change(input, { target: { files: [first, second] } });

    const moveRight = screen.getByRole('button', { name: 'Move a.png right' });
    fireEvent.click(moveRight);

    // After moving "a" right of "b", the "a" move-left button should now be enabled
    // (it moved out of the first position) while "b" is first and its left-move is disabled.
    expect(screen.getByRole('button', { name: 'Move b.png left' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move a.png left' })).not.toBeDisabled();
  });
});
