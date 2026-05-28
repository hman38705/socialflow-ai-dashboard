import { AppError } from '../../utils/AppError';
import { ErrorCode } from '../../constants/ErrorCodes';
import {
  IPFSClient,
  MB,
  timeoutSignal,
  idbPut,
  idbGet,
  idbAll,
  idbDelete,
  openDb,
} from './IPFSClient';

export class IPFSRetriever {
  private client: IPFSClient

  constructor(client: IPFSClient) {
    this.client = client
  }

  private async fetchWithGatewayFallback(cid: string, timeoutMs = 30_000): Promise<Response> {
    const gateways = this.client.config.gatewayUrls
    let lastErr: any
    for (const gw of gateways) {
      const url = gw + cid
      const { signal, clear } = timeoutSignal(timeoutMs)
      try {
        const res = await fetch(url, { signal })
        clear()
        if (res.ok) return res
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr || new AppError(ErrorCode.ERR_NETWORK_ERROR, 'All gateways failed')
  }

  async getFile(cid: string): Promise<Blob> {
    const cached = await idbGet('files', cid)
    if (cached && cached.data) {
      await idbPut('files', { ...cached, lastAccess: Date.now() })
      return new Blob([cached.data])
    }
    const res = await this.fetchWithGatewayFallback(cid)
    const blob = await res.blob()
    await this.cacheFile(cid, blob)
    return blob
  }

  async getJSON(cid: string): Promise<any> {
    const res = await this.fetchWithGatewayFallback(cid)
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch (e) {
      throw new AppError(ErrorCode.ERR_INVALID_FORMAT, 'Invalid JSON')
    }
  }

  async cacheFile(cid: string, blob: Blob) {
    const size = blob.size
    const data = await blob.arrayBuffer()
    const entry = { cid, data, size, lastAccess: Date.now() }
    await idbPut('files', entry)
    await this.enforceCacheLimit()
  }

  async getCacheSize() {
    const all = await idbAll('files')
    return all.reduce((s, e) => s + (e.size || 0), 0)
  }

  async clearCache() {
    const db = await openDb()
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      tx.objectStore('files').clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  private async enforceCacheLimit() {
    const limit = 500 * MB
    const all = await idbAll('files')
    let total = all.reduce((s, e) => s + (e.size || 0), 0)
    if (total <= limit) return
    all.sort((a, b) => (a.lastAccess || 0) - (b.lastAccess || 0))
    for (const entry of all) {
      const pin = await idbGet('pins', entry.cid)
      if (pin?.pinned) continue
      await idbDelete('files', entry.cid)
      total -= entry.size || 0
      if (total <= limit) break
    }
  }

  async unpinFile(cid: string) {
    if (this.client.config.provider === 'pinata') {
      const url = `https://api.pinata.cloud/pinning/unpin/${cid}`
      const headers: any = {}
      if (this.client.config.apiKey && this.client.config.secret) {
        headers['pinata_api_key'] = this.client.config.apiKey
        headers['pinata_secret_api_key'] = this.client.config.secret
      } else if (this.client.config.apiKey) headers['Authorization'] = `Bearer ${this.client.config.apiKey}`
      const res = await fetch(url, { method: 'DELETE', headers })
      if (!res.ok) throw new AppError(ErrorCode.ERR_TRANSACTION_FAILED, 'Unpin failed')
      await idbPut('pins', { cid, pinned: false, provider: 'pinata', updatedAt: Date.now() })
      return true
    } else {
      await idbPut('pins', { cid, pinned: false, provider: 'web3', updatedAt: Date.now() })
      return true
    }
  }
}
