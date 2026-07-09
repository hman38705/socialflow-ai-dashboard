import { IPFSClient, IPFSConfig, IPFSUploadResult, DEFAULT_GATEWAYS } from './IPFSClient';
import { IPFSUploader } from './IPFSUploader';
import { IPFSRetriever } from './IPFSRetriever';

export type { IPFSConfig, IPFSUploadResult };

export class IPFSService {
  config: IPFSConfig
  private client: IPFSClient
  private uploader: IPFSUploader
  private retriever: IPFSRetriever

  constructor(config?: Partial<IPFSConfig>) {
    this.client = new IPFSClient(config)
    this.config = this.client.config
    this.uploader = new IPFSUploader(this.client)
    this.retriever = new IPFSRetriever(this.client)
  }

  static fromEnv(): IPFSConfig {
    return IPFSClient.fromEnv()
  }

  // Upload operations (delegated to IPFSUploader)
  uploadFile(file: File, onProgress?: (uploadedBytes: number, totalBytes: number) => void): Promise<IPFSUploadResult> {
    return this.uploader.uploadFile(file, onProgress)
  }

  uploadJSON(metadata: any): Promise<{ cid: string; uri: string }> {
    return this.uploader.uploadJSON(metadata)
  }

  uploadBatch(files: File[], onProgress?: (completed: number, total: number) => void) {
    return this.uploader.uploadBatch(files, onProgress)
  }

  pinFile(cid: string) {
    return this.uploader.pinFile(cid)
  }

  getPinnedFiles() {
    return this.uploader.getPinnedFiles()
  }

  // Retrieval operations (delegated to IPFSRetriever)
  getFile(cid: string): Promise<Blob> {
    return this.retriever.getFile(cid)
  }

  getJSON(cid: string): Promise<any> {
    return this.retriever.getJSON(cid)
  }

  cacheFile(cid: string, blob: Blob) {
    return this.retriever.cacheFile(cid, blob)
  }

  getCacheSize() {
    return this.retriever.getCacheSize()
  }

  clearCache() {
    return this.retriever.clearCache()
  }

  unpinFile(cid: string) {
    return this.retriever.unpinFile(cid)
  }

  // Connection helpers (delegated to IPFSClient)
  getFileUrl(cid: string) {
    return this.client.getFileUrl(cid)
  }
}

const ipfsService = new IPFSService()
export default ipfsService
