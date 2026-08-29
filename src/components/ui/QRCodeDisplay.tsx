import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

export interface QRCodeDisplayProps {
  uri: string;
  secret: string;
  size?: number;
}

export function QRCodeDisplay({ uri, secret, size = 256 }: QRCodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    setState('loading');
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, uri, {
      width: size,
      margin: 4,
      errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then(() => setState('ready'))
      .catch(() => setState('error'));
  }, [uri, size]);
  return (
    <div className="qr-code-display" aria-label="2FA setup code">
      {state === 'loading' && (
        <div
          role="status"
          aria-label="Loading 2FA setup code"
          style={{ width: size, height: size }}
        />
      )}
      {state === 'error' && (
        <p role="alert">
          Unable to generate QR code. Enter this key manually: <code>{secret}</code>
        </p>
      )}
      <canvas
        ref={canvasRef}
        aria-label="2FA setup QR code"
        style={{ display: state === 'ready' ? 'block' : 'none', backgroundColor: '#fff' }}
      />
      <p>
        Manual entry key: <code>{secret}</code>
      </p>
    </div>
  );
}

export default QRCodeDisplay;
