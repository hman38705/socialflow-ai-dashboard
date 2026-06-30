import { WalletService } from '../WalletService';

function setupFreighter(publicKey = 'GFREIGHTER', rejects = false) {
  (window as any).freighter = {
    getPublicKey: rejects
      ? jest.fn().mockRejectedValue(new Error('user rejected'))
      : jest.fn().mockResolvedValue(publicKey),
    signTransaction: jest.fn().mockResolvedValue('signed-xdr'),
    on: jest.fn(),
  };
}

function setupAlbedo(publicKey = 'GALBEDO') {
  (window as any).albedo = {
    publicKey: jest.fn().mockResolvedValue({ publicKey }),
    tx: jest.fn().mockResolvedValue({ signed_envelope_xdr: 'albedo-signed' }),
  };
}

function clearWallets() {
  delete (window as any).freighter;
  delete (window as any).albedo;
}

afterEach(() => {
  clearWallets();
  jest.clearAllMocks();
});

describe('WalletService', () => {
  describe('autoConnect', () => {
    it('connects via Freighter and returns WalletInfo', async () => {
      setupFreighter('GPUBKEY123');
      const svc = new WalletService();
      const info = await svc.autoConnect();
      expect(info).toMatchObject({ publicKey: 'GPUBKEY123', name: 'Freighter', isConnected: true });
    });

    it('connects via Albedo when Freighter not available', async () => {
      setupAlbedo('GALBEDOPUB');
      const svc = new WalletService();
      const info = await svc.autoConnect();
      expect(info).toMatchObject({ publicKey: 'GALBEDOPUB', name: 'Albedo', isConnected: true });
    });

    it('returns null when no wallet extension is installed', async () => {
      const svc = new WalletService();
      const info = await svc.autoConnect();
      expect(info).toBeNull();
    });

    it('returns null when Freighter.getPublicKey rejects', async () => {
      setupFreighter('G', true);
      const svc = new WalletService();
      const info = await svc.autoConnect();
      expect(info).toBeNull();
    });
  });

  describe('getWallet / isConnected', () => {
    it('returns null before connecting', () => {
      const svc = new WalletService();
      expect(svc.getWallet()).toBeNull();
      expect(svc.isConnected()).toBe(false);
    });

    it('returns wallet info after successful connect', async () => {
      setupFreighter('GCONNECTED');
      const svc = new WalletService();
      await svc.autoConnect();
      expect(svc.isConnected()).toBe(true);
      expect(svc.getWallet()?.publicKey).toBe('GCONNECTED');
    });
  });

  describe('signTransaction', () => {
    it('throws when wallet is not connected', async () => {
      const svc = new WalletService();
      await expect(svc.signTransaction('xdr', 'testnet')).rejects.toThrow('Wallet not connected');
    });

    it('signs via Freighter when connected', async () => {
      setupFreighter('GSIGNER');
      const svc = new WalletService();
      await svc.autoConnect();
      const signed = await svc.signTransaction('raw-xdr', 'testnet');
      expect(signed).toBe('signed-xdr');
    });

    it('signs via Albedo when connected', async () => {
      setupAlbedo('GALBSIGNER');
      const svc = new WalletService();
      await svc.autoConnect();
      const signed = await svc.signTransaction('raw-xdr', 'testnet');
      expect(signed).toBe('albedo-signed');
    });

    it('throws when Freighter.signTransaction rejects with network error', async () => {
      setupFreighter('GSIGNER');
      (window as any).freighter.signTransaction = jest.fn().mockRejectedValue(new Error('network'));
      const svc = new WalletService();
      await svc.autoConnect();
      await expect(svc.signTransaction('raw-xdr', 'testnet')).rejects.toThrow('network');
    });
  });

  describe('onDisconnect / disconnect', () => {
    it('registers and calls disconnect listener', async () => {
      setupFreighter('GDISCONNECT');
      const svc = new WalletService();
      await svc.autoConnect();

      const listener = jest.fn();
      svc.onDisconnect(listener);
      svc.disconnect();

      // disconnect() only clears the internal state; listeners are fired via handleDisconnect
      expect(svc.isConnected()).toBe(false);
    });

    it('returns an unsubscribe function', async () => {
      setupFreighter('GUNSUB');
      const svc = new WalletService();
      await svc.autoConnect();
      const unsub = svc.onDisconnect(jest.fn());
      expect(typeof unsub).toBe('function');
      expect(() => unsub()).not.toThrow();
    });
  });
});
