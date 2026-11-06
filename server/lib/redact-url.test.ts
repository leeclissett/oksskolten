import { describe, it, expect } from 'vitest'
import { redactUrlSecrets } from './redact-url.js'

describe('redactUrlSecrets', () => {
  it('redacts Passwd at the end of the query', () => {
    expect(redactUrlSecrets('/accounts/ClientLogin?Email=a&Passwd=s3cret'))
      .toBe('/accounts/ClientLogin?Email=a&Passwd=[redacted]')
  })

  it('redacts Passwd at the start or in the middle of the query', () => {
    expect(redactUrlSecrets('/accounts/ClientLogin?Passwd=s3cret&Email=a'))
      .toBe('/accounts/ClientLogin?Passwd=[redacted]&Email=a')
    expect(redactUrlSecrets('/api/greader.php/accounts/ClientLogin?Email=a&Passwd=s3cret&client=x'))
      .toBe('/api/greader.php/accounts/ClientLogin?Email=a&Passwd=[redacted]&client=x')
  })

  it('redacts percent-encoded values', () => {
    expect(redactUrlSecrets('/accounts/ClientLogin?Email=a%40b.c&Passwd=p%40ss%26word%3D1'))
      .toBe('/accounts/ClientLogin?Email=a%40b.c&Passwd=[redacted]')
  })

  it('tolerates a lowercase or percent-encoded parameter name and repeated parameters', () => {
    expect(redactUrlSecrets('/accounts/ClientLogin?passwd=x')).toBe('/accounts/ClientLogin?passwd=[redacted]')
    expect(redactUrlSecrets('/accounts/ClientLogin?P%61sswd=x')).toBe('/accounts/ClientLogin?P%61sswd=[redacted]')
    expect(redactUrlSecrets('/accounts/ClientLogin?Passwd=a&Passwd=b'))
      .toBe('/accounts/ClientLogin?Passwd=[redacted]&Passwd=[redacted]')
  })

  it('keeps a fragment after the query', () => {
    expect(redactUrlSecrets('/x?Passwd=s#frag')).toBe('/x?Passwd=[redacted]#frag')
  })

  it('leaves a URL with no query unchanged', () => {
    expect(redactUrlSecrets('/accounts/ClientLogin')).toBe('/accounts/ClientLogin')
  })

  it('leaves a non-login URL unchanged', () => {
    const url = '/reader/api/0/stream/items/ids?s=user%2F-%2Fstate%2Fcom.google%2Freading-list&n=1000&xt=read'
    expect(redactUrlSecrets(url)).toBe(url)
    expect(redactUrlSecrets('/api/feeds?PasswdHint=1&passwordless=true')).toBe('/api/feeds?PasswdHint=1&passwordless=true')
  })
})
