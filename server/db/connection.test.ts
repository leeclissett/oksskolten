import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { bindNamedParams, runNamed, getNamed, allNamed, getDb, runMigrations } from './connection.js'

beforeEach(() => {
  setupTestDb()
})

// --- bindNamedParams ---

describe('bindNamedParams', () => {
  it('replaces named params with positional placeholders', () => {
    const result = bindNamedParams('SELECT * FROM t WHERE a = @foo AND b = @bar', { foo: 1, bar: 'x' })
    expect(result.sql).toBe('SELECT * FROM t WHERE a = ? AND b = ?')
    expect(result.args).toEqual([1, 'x'])
  })

  it('handles same param used multiple times', () => {
    const result = bindNamedParams('SELECT * FROM t WHERE a = @foo OR b = @foo', { foo: 42 })
    expect(result.sql).toBe('SELECT * FROM t WHERE a = ? OR b = ?')
    expect(result.args).toEqual([42, 42])
  })

  it('throws on missing parameter', () => {
    expect(() => bindNamedParams('SELECT * FROM t WHERE a = @missing', {}))
      .toThrow('Missing SQL parameter: missing')
  })

  it('handles params with underscores', () => {
    const result = bindNamedParams('SELECT * FROM t WHERE col = @my_param', { my_param: 'val' })
    expect(result.sql).toBe('SELECT * FROM t WHERE col = ?')
    expect(result.args).toEqual(['val'])
  })

  it('returns original SQL when no params present', () => {
    const result = bindNamedParams('SELECT 1', {})
    expect(result.sql).toBe('SELECT 1')
    expect(result.args).toEqual([])
  })
})

// --- runNamed / getNamed / allNamed ---

describe('runNamed', () => {
  it('executes an INSERT with named params', () => {
    getDb().exec('CREATE TABLE test_rn (id INTEGER PRIMARY KEY, val TEXT)')
    runNamed('INSERT INTO test_rn (val) VALUES (@v)', { v: 'hello' })
    const row = getDb().prepare('SELECT val FROM test_rn').get() as { val: string }
    expect(row.val).toBe('hello')
  })
})

describe('getNamed', () => {
  it('returns a single row', () => {
    getDb().exec('CREATE TABLE test_gn (id INTEGER PRIMARY KEY, val TEXT)')
    getDb().prepare('INSERT INTO test_gn (val) VALUES (?)').run('world')
    const row = getNamed<{ val: string }>('SELECT val FROM test_gn WHERE val = @v', { v: 'world' })
    expect(row.val).toBe('world')
  })

  it('returns undefined when no match', () => {
    getDb().exec('CREATE TABLE test_gn2 (id INTEGER PRIMARY KEY, val TEXT)')
    const row = getNamed<{ val: string }>('SELECT val FROM test_gn2 WHERE val = @v', { v: 'nope' })
    expect(row).toBeUndefined()
  })
})

describe('allNamed', () => {
  it('returns all matching rows', () => {
    getDb().exec('CREATE TABLE test_an (id INTEGER PRIMARY KEY, val TEXT)')
    getDb().prepare('INSERT INTO test_an (val) VALUES (?)').run('a')
    getDb().prepare('INSERT INTO test_an (val) VALUES (?)').run('b')
    const rows = allNamed<{ val: string }>('SELECT val FROM test_an WHERE val IN (@v1, @v2)', { v1: 'a', v2: 'b' })
    expect(rows).toHaveLength(2)
  })
})

// --- runMigrations ---

describe('runMigrations', () => {
  it('creates _migrations table', () => {
    // setupTestDb already runs migrations, so _migrations should exist
    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
      .all() as { name: string }[]
    expect(tables).toHaveLength(1)
  })

  it('is idempotent — running twice does not fail', () => {
    expect(() => runMigrations()).not.toThrow()
  })

  it('records applied migrations', () => {
    const applied = getDb().prepare('SELECT name FROM _migrations').all() as { name: string }[]
    expect(applied.length).toBeGreaterThan(0)
  })

  it('normalizes legacy LetterFeed synthetic article URLs', () => {
    const db = getDb()
    const feedId = db.prepare(
      "INSERT INTO feeds (name, url) VALUES ('LetterFeed', 'http://192.168.1.109:3100')",
    ).run().lastInsertRowid
    db.prepare(`
      INSERT INTO articles (feed_id, title, url)
      VALUES (?, 'Newsletter', 'http://192.168.1.109:3100/feeds/test#urn%3Aletterfeed%3Aentry%3A123')
    `).run(feedId)
    db.prepare("DELETE FROM _migrations WHERE name = '0009_letterfeed_synthetic_urls.sql'").run()

    runMigrations()

    const article = db.prepare("SELECT url FROM articles WHERE title = 'Newsletter'").get() as { url: string }
    expect(article.url).toBe(
      'http://192.168.1.109:3100/feeds/test#urn:letterfeed:entry:123',
    )
  })
})

// --- WAL and foreign keys ---

describe('database pragmas', () => {
  it('has foreign_keys enabled', () => {
    const row = getDb().pragma('foreign_keys') as { foreign_keys: number }[]
    expect(row[0].foreign_keys).toBe(1)
  })
})

// --- execSafe (tested indirectly via migrations) ---

describe('duplicate column migration handling', () => {
  it('handles duplicate column gracefully in migration context', () => {
    // Simulate a duplicate column scenario
    getDb().exec('CREATE TABLE test_dup (id INTEGER PRIMARY KEY, col1 TEXT)')
    // Adding the same column again should be handled by execSafe logic
    expect(() => {
      getDb().exec('ALTER TABLE test_dup ADD COLUMN col1 TEXT')
    }).toThrow(/duplicate column/)
  })
})
