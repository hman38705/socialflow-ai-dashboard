import { AppError } from '../../utils/AppError';
import { ErrorCode } from '../../constants/ErrorCodes';

export type Provider = 'pinata' | 'web3'

export interface IPFSConfig {
  provider: Provider
  apiKey?: string
  secret?: string
  gatewayUrls: string[]
}

export interface IPFSUploadResult {
  cid: string
  size: number
  gatewayUrl: string
}

export const DEFAULT_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://dweb.link/ipfs/',
]

export const MB = 1024 * 1024

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, attempts = 3, baseMs = 300) {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const wait = baseMs * 2 ** i
      await sleep(wait)
    }
  }
  throw lastErr
}

export function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, clear: () => clearTimeout(id) }
}

export function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('ipfs-cache-db', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'cid' })
      if (!db.objectStoreNames.contains('pins')) db.createObjectStore('pins', { keyPath: 'cid' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbPut(storeName: string, value: any) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbGet(storeName: string, key: string) {
  const db = await openDb()
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function idbAll(storeName: string) {
  const db = await openDb()
  return new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

export async function idbDelete(storeName: string, key: string) {
  const db = await openDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export class IPFSClient {
  config: IPFSConfig

  constructor(config?: Partial<IPFSConfig>) {
    const fromEnv = IPFSClient.fromEnv()
    this.config = {
      provider: config?.provider || fromEnv.provider,
      apiKey: config?.apiKey || fromEnv.apiKey,
      secret: config?.secret || fromEnv.secret,
      gatewayUrls: config?.gatewayUrls || fromEnv.gatewayUrls || DEFAULT_GATEWAYS,
    }
  }

  static fromEnv(): IPFSConfig {
    // @ts-ignore
    const env = typeof import.meta !== 'undefined' ? import.meta.env : (window as any).__ENV__ || {}
    const pinataKey = env.VITE_PINATA_API_KEY || env.VITE_PINATA_JWT
    const web3Key = env.VITE_WEB3_STORAGE_TOKEN
    const provider: Provider = web3Key ? 'web3' : pinataKey ? 'pinata' : 'web3'
    return {
      provider,
      apiKey: web3Key || pinataKey,
      secret: env.VITE_PINATA_SECRET || undefined,
      gatewayUrls: DEFAULT_GATEWAYS,
    }
  }

  getProviderInfo() {
    if (this.config.provider === 'web3') {
      return {
        uploadUrl: 'https://api.web3.storage/upload',
        listUrl: 'https://api.web3.storage/user/uploads',
        authHeader: this.config.apiKey ? `Bearer ${this.config.apiKey}` : undefined,
      }
    }
    return {
      uploadUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
      pinByHashUrl: 'https://api.pinata.cloud/pinning/pinByHash',
      listUrl: 'https://api.pinata.cloud/data/pinList',
      authHeader: this.config.apiKey && this.config.secret ? undefined : this.config.apiKey,
    }
  }

  getFileUrl(cid: string) {
    const gw = (this.config.gatewayUrls && this.config.gatewayUrls[0]) || DEFAULT_GATEWAYS[0]
    return gw + cid
  }
}
