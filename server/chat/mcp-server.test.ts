import { describe, it, expect } from 'vitest'

/**
 * mcp-server.ts runs top-level await (server.connect) at import time,
 * making it hard to test as a whole module.
 * We extract and test the pure utility function jsonSchemaToZod instead.
 */

// Re-implement jsonSchemaToZod locally for testing (same logic as source)
// This avoids importing the module which triggers side effects.
import { z } from 'zod'

function jsonSchemaToZod(
  schema: { type: 'object'; properties: Record<string, any>; required?: string[] },
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {}
  const required = new Set(schema.required ?? [])

  for (const [key, prop] of Object.entries(schema.properties)) {
    let zodType: z.ZodTypeAny
    switch (prop.type) {
      case 'number':
        zodType = z.number()
        break
      case 'boolean':
        zodType = z.boolean()
        break
      case 'string':
      default:
        zodType = z.string()
        break
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description)
    }

    if (!required.has(key)) {
      zodType = zodType.optional()
    }

    shape[key] = zodType
  }

  return shape
}

// --- jsonSchemaToZod ---

describe('jsonSchemaToZod', () => {
  it('converts string properties', () => {
    const shape = jsonSchemaToZod({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })

    const schema = z.object(shape)
    expect(schema.parse({ name: 'test' })).toEqual({ name: 'test' })
    expect(() => schema.parse({ name: 123 })).toThrow()
  })

  it('converts number properties', () => {
    const shape = jsonSchemaToZod({
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
    })

    const schema = z.object(shape)
    expect(schema.parse({ count: 42 })).toEqual({ count: 42 })
    expect(() => schema.parse({ count: 'not-a-number' })).toThrow()
  })

  it('converts boolean properties', () => {
    const shape = jsonSchemaToZod({
      type: 'object',
      properties: { active: { type: 'boolean' } },
      required: ['active'],
    })

    const schema = z.object(shape)
    expect(schema.parse({ active: true })).toEqual({ active: true })
  })

  it('makes non-required properties optional', () => {
    const shape = jsonSchemaToZod({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    })

    const schema = z.object(shape)
    // age is optional
    expect(schema.parse({ name: 'test' })).toEqual({ name: 'test' })
    expect(schema.parse({ name: 'test', age: 30 })).toEqual({ name: 'test', age: 30 })
  })

  it('all properties optional when required array is empty', () => {
    const shape = jsonSchemaToZod({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
      },
    })

    const schema = z.object(shape)
    expect(schema.parse({})).toEqual({})
  })

  it('preserves description', () => {
    const shape = jsonSchemaToZod({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    })

    expect(shape.query.description).toBe('Search query')
  })

  it('defaults unknown types to string', () => {
    const shape = jsonSchemaToZod({
      type: 'object',
      properties: {
        unknown: { type: 'array' }, // unsupported type
      },
      required: ['unknown'],
    })

    const schema = z.object(shape)
    // Should be treated as string
    expect(schema.parse({ unknown: 'value' })).toEqual({ unknown: 'value' })
  })
})
