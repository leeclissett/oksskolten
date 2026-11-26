import { authHeaders } from './fetcher'

const DB_NAME = 'reader-offline'
const STORE_NAME = 'read-queue'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function queueSeenIds(ids: number[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  for (const articleId of ids) {
    store.add({ articleId, ts: Date.now() })
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

let flushing = false

export async function flushOfflineQueue(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    await doFlush()
  } finally {
    flushing = false
  }
}

async function doFlush(): Promise<void> {
  const db = await openDB()

  // Read all queued items
  const items = await new Promise<Array<{ id: number; articleId: number }>>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  if (items.length === 0) return

  const ids = [...new Set(items.map(i => i.articleId))]

  // Attempt to send to server
  const res = await fetch('/api/articles/batch-seen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ids }),
  })

  if (!res.ok) throw new Error('flush failed')

  // Clear the queue on success
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).clear()
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
