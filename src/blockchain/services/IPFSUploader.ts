import { AppError } from '../../utils/AppError';
import { ErrorCode } from '../../constants/ErrorCodes';
import {
  IPFSClient,
  IPFSUploadResult,
  MB,
  retryWithBackoff,
  idbPut,
  idbAll,
} from './IPFSClient';

export class IPFSUploader {
  private client: IPFSClient

  constructor(client: IPFSClient) {
    this.client = client
  }

  async uploadFile(
    file: File,
    onProgress?: (uploadedBytes: number, totalBytes: number) => void
  ): Promise<IPFSUploadResult> {
    const size = file.size
    const chunkThreshold = 10 * MB
    if (size > chunkThreshold) {
      return this.uploadFileChunked(file, onProgress)
    }
    return this.uploadFileSimple(file, onProgress)
  }

  private async uploadFileSimple(file: File, _onProgress?: (a: number, b: number) => void) {
    const info = this.client.getProviderInfo()
    if (this.client.config.provider === 'web3') {
      const form = new FormData()
      form.append('file', file, file.name)
      const res = await retryWithBackoff(() => fetch(info.uploadUrl!, { method: 'POST', headers: { Authorization: info.authHeader || '' }, body: form }), 3)
      if (!res.ok) throw new AppError(ErrorCode.ERR_NETWORK_ERROR, `Upload failed ${res.status}`)
      const data = await res.json()
      const cid = data.cid || (data[0] && data[0].cid) || ''
      const gatewayUrl = this.client.getFileUrl(cid)
      return { cid, size: file.size, gatewayUrl }
    } else {
      const form = new FormData()
      form.append('file', file, file.name)
      const headers: any = {}
      if (this.client.config.apiKey && this.client.config.secret) {
        headers['pinata_api_key'] = this.client.config.apiKey
        headers['pinata_secret_api_key'] = this.client.config.secret
      } else if (this.client.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.client.config.apiKey}`
      }
      const res = await retryWithBackoff(() => fetch(info.uploadUrl!, { method: 'POST', headers, body: form }), 3)
      if (!res.ok) throw new AppError(ErrorCode.ERR_NETWORK_ERROR, `Upload failed ${res.status}`)
      const data = await res.json()
      const cid = data.IpfsHash || data.ipfsHash || ''
      const gatewayUrl = this.client.getFileUrl(cid)
      return { cid, size: file.size, gatewayUrl }
    }
  }

  private async uploadFileChunked(file: File, onProgress?: (a: number, b: number) => void) {
    const chunkSize = 5 * MB
    let uploaded = 0

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const start = uploaded
        if (start >= file.size) {
          controller.close()
          return
        }
        const end = Math.min(start + chunkSize, file.size)
        const blob = file.slice(start, end)
        const arr = new Uint8Array(await blob.arrayBuffer())
        controller.enqueue(arr)
        uploaded = end
        if (onProgress) onProgress(uploaded, file.size)
      },
    })

    const info = this.client.getProviderInfo()
    const headers: any = {}
    if (this.client.config.provider === 'web3') {
      if (info.authHeader) headers['Authorization'] = info.authHeader
      headers['Content-Type'] = 'application/octet-stream'
      const res = await retryWithBackoff(() => fetch(info.uploadUrl!, { method: 'POST', headers, body: stream as any }), 3)
      if (!res.ok) throw new AppError(ErrorCode.ERR_NETWORK_ERROR, `Upload failed ${res.status}`)
      const data = await res.json()
      const cid = data.cid || ''
      return { cid, size: file.size, gatewayUrl: this.client.getFileUrl(cid) }
    } else {
      return this.uploadFileSimple(file, onProgress)
    }
  }

  async uploadJSON(metadata: any): Promise<{ cid: string; uri: string }> {
    if (typeof metadata !== 'object' || metadata === null) throw new AppError(ErrorCode.ERR_BAD_REQUEST, 'Invalid metadata')
    const info = this.client.getProviderInfo()
    if (this.client.config.provider === 'web3') {
      const headers: any = { Authorization: info.authHeader || '', 'Content-Type': 'application/json' }
      const res = await retryWithBackoff(() => fetch(info.uploadUrl!, { method: 'POST', headers, body: JSON.stringify(metadata) }), 3)
      if (!res.ok) throw new Error('JSON upload failed')
      const data = await res.json()
      const cid = data.cid || ''
      return { cid, uri: `ipfs://${cid}` }
    } else {
      const url = 'https://api.pinata.cloud/pinning/pinJSONToIPFS'
      const headers: any = { 'Content-Type': 'application/json' }
      if (this.client.config.apiKey && this.client.config.secret) {
        headers['pinata_api_key'] = this.client.config.apiKey
        headers['pinata_secret_api_key'] = this.client.config.secret
      } else if (this.client.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.client.config.apiKey}`
      }
      const res = await retryWithBackoff(() => fetch(url, { method: 'POST', headers, body: JSON.stringify(metadata) }), 3)
      if (!res.ok) throw new Error('JSON upload failed')
      const data = await res.json()
      const cid = data.IpfsHash || data.ipfsHash || ''
      return { cid, uri: `ipfs://${cid}` }
    }
  }

  async uploadBatch(files: File[], onProgress?: (completed: number, total: number) => void) {
    const concurrency = 3
    const results: IPFSUploadResult[] = []
    let index = 0
    let completed = 0

    const runOne = async () => {
      while (index < files.length) {
        const i = index++
        try {
          const res = await this.uploadFile(files[i], (_u, _t) => {})
          results[i] = res
        } catch (e) {
          results[i] = { cid: '', size: files[i].size, gatewayUrl: '' }
        }
        completed++
        if (onProgress) onProgress(completed, files.length)
      }
    }

    const workers = []
    for (let i = 0; i < concurrency; i++) workers.push(runOne())
    await Promise.all(workers)
    return results
  }

  async pinFile(cid: string) {
    const info = this.client.getProviderInfo()
    if (this.client.config.provider === 'pinata') {
      const url = info.pinByHashUrl!
      const headers: any = { 'Content-Type': 'application/json' }
      if (this.client.config.apiKey && this.client.config.secret) {
        headers['pinata_api_key'] = this.client.config.apiKey
        headers['pinata_secret_api_key'] = this.client.config.secret
      } else if (this.client.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.client.config.apiKey}`
      }
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ hashToPin: cid }) })
      if (!res.ok) throw new AppError(ErrorCode.ERR_TRANSACTION_FAILED, 'Pin failed')
      await idbPut('pins', { cid, pinned: true, provider: 'pinata', updatedAt: Date.now() })
      return true
    } else {
      await idbPut('pins', { cid, pinned: true, provider: 'web3', updatedAt: Date.now() })
      return true
    }
  }

  async getPinnedFiles() {
    const local = await idbAll('pins')
    const info = this.client.getProviderInfo()
    let remote: any[] = []
    try {
      if (this.client.config.provider === 'web3') {
        const res = await fetch(info.listUrl!, { headers: { Authorization: info.authHeader || '' } })
        if (res.ok) remote = await res.json()
      } else {
        const url = `${info.listUrl}?status=pinned`
        const headers: any = {}
        if (this.client.config.apiKey && this.client.config.secret) {
          headers['pinata_api_key'] = this.client.config.apiKey
          headers['pinata_secret_api_key'] = this.client.config.secret
        } else if (this.client.config.apiKey) headers['Authorization'] = `Bearer ${this.client.config.apiKey}`
        const res = await fetch(url, { headers })
        if (res.ok) remote = await res.json()
      }
    } catch (e) {
      // ignore remote failures
    }
    return { local, remote }
  }
}
