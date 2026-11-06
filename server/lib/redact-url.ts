/** Query parameter names whose values must never reach the logs (ClientLogin via GET). */
const SECRET_PARAMS = new Set(['Passwd', 'passwd'])

/**
 * `url` with the value of any `Passwd` query parameter replaced by `[redacted]`.
 * Everything else, including the encoding of other parameters, is left as is.
 * Parameter names are matched after percent-decoding, so `P%61sswd` is caught too.
 */
export function redactUrlSecrets(url: string): string {
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return url
  const hashStart = url.indexOf('#', queryStart)
  const queryEnd = hashStart === -1 ? url.length : hashStart
  const query = url.slice(queryStart + 1, queryEnd)

  let changed = false
  const parts = query.split('&').map((part) => {
    const eq = part.indexOf('=')
    const rawName = eq === -1 ? part : part.slice(0, eq)
    if (!SECRET_PARAMS.has(decodeName(rawName))) return part
    changed = true
    return `${rawName}=[redacted]`
  })
  if (!changed) return url
  return `${url.slice(0, queryStart + 1)}${parts.join('&')}${url.slice(queryEnd)}`
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name.replace(/\+/g, ' '))
  } catch {
    return name
  }
}
