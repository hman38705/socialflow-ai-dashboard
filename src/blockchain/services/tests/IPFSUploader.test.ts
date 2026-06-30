/** @vitest-environment jsdom */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { IPFSClient, MB } from '../IPFSClient'
import { IPFSUploader } from '../IPFSUploader'

describe('IPFSUploader', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch
  })

  test('uploadBatch surfaces per-file errors and continues sibling uploads', async () => {
    const client = new IPFSClient({ provider: 'pinata', apiKey: 'test-key', secret: 'test-secret' })
    const uploader = new IPFSUploader(client)

    const files = [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
      new File(['b'], 'b.txt', { type: 'text/plain' }),
      new File(['c'], 'c.txt', { type: 'text/plain' }),
    ]

    const uploadFileMock = vi.spyOn(uploader, 'uploadFile')
    uploadFileMock
      .mockResolvedValueOnce({ cid: 'cid-a', size: 1, gatewayUrl: 'https://ipfs.io/ipfs/cid-a' })
      .mockRejectedValueOnce(new Error('Server rejected file'))
      .mockResolvedValueOnce({ cid: 'cid-c', size: 1, gatewayUrl: 'https://ipfs.io/ipfs/cid-c' })

    const progress: Array<[number, number]> = []
    const results = await uploader.uploadBatch(files, (completed, total) => {
      progress.push([completed, total])
    })

    expect(results).toHaveLength(3)
    expect(results[0]).toEqual({ cid: 'cid-a', size: 1, gatewayUrl: 'https://ipfs.io/ipfs/cid-a' })
    expect(results[1]).toEqual({ cid: '', size: 1, gatewayUrl: '', error: 'Server rejected file' })
    expect(results[2]).toEqual({ cid: 'cid-c', size: 1, gatewayUrl: 'https://ipfs.io/ipfs/cid-c' })
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]])
    expect(uploadFileMock).toHaveBeenCalledTimes(3)
  })

  test('uploadFile chunked upload emits progress and splits into expected chunks', async () => {
    const client = new IPFSClient({ provider: 'web3', apiKey: 'test-token' })
    const uploader = new IPFSUploader(client)
    const size = 11 * MB
    const file = new File([new Uint8Array(size)], 'large.bin', { type: 'application/octet-stream' })

    const chunks: number[] = []
    const fetchMock = vi.fn(async (_url, options: any) => {
      const body = options.body as ReadableStream<Uint8Array>
      const reader = body.getReader()
      let total = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value.byteLength)
          total += value.byteLength
        }
      }

      expect(total).toBe(size)
      return new Response(JSON.stringify({ cid: 'cid-chunked' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    const progress: number[] = []
    const result = await uploader.uploadFile(file, (uploaded, total) => {
      expect(total).toBe(size)
      progress.push(uploaded)
    })

    expect(result.gatewayUrl).toBe(client.getFileUrl('cid-chunked'))
    expect(result.cid).toBe('cid-chunked')
    expect(result.size).toBe(size)
    expect(chunks).toEqual([5 * MB, 5 * MB, size - 10 * MB])
    expect(progress).toEqual([5 * MB, 10 * MB, size])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
