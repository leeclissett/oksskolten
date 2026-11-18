import { spawn } from 'node:child_process'
import type { LLMProvider, LLMMessageParams, LLMStreamResult } from './provider.js'

const CLAUDE_CODE_TIMEOUT_MS = 90_000

function promptFrom(params: LLMMessageParams): string {
  return params.messages.map(m => m.content).join('\n\n')
}

function spawnClaudeCode(
  model: string,
  prompt: string,
  onText?: (delta: string) => void,
): Promise<LLMStreamResult> {
  const args = [
    '-p',
    '--verbose',
    '--include-partial-messages',
    '--output-format', 'stream-json',
    '--model', model,
    '--no-session-persistence',
    '--dangerously-skip-permissions',
  ]

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      env: { ...process.env, CLAUDECODE: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    proc.stdin.write(prompt)
    proc.stdin.end()

    let buffer = ''
    let text = ''
    let stderrText = ''
    let usage = { inputTokens: 0, outputTokens: 0 }
    let sawTextDelta = false
    let lastAssistantText = ''
    let timeoutMessage: string | null = null
    let timeoutId: NodeJS.Timeout | null = null

    const refreshTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        timeoutMessage = `Claude Code timed out after ${Math.round(CLAUDE_CODE_TIMEOUT_MS / 1000)}s`
        proc.kill('SIGKILL')
      }, CLAUDE_CODE_TIMEOUT_MS)
    }

    const appendText = (delta: string) => {
      if (!delta) return
      sawTextDelta = true
      text += delta
      onText?.(delta)
    }

    const getAssistantText = (event: any): string => {
      const content = event?.message?.content ?? event?.content ?? []
      return content
        .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text)
        .join('')
    }

    const handleEvent = (event: any) => {
      if (event?.type === 'system' || event?.type === 'message_start' || event?.type === 'message_stop') return
      if (event?.type === 'stream_event' && event.event) {
        handleEvent(event.event)
        return
      }
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        appendText(event.delta.text ?? '')
        return
      }
      if (event?.type === 'message_delta' && event.usage) {
        usage = {
          inputTokens: event.usage.input_tokens ?? usage.inputTokens,
          outputTokens: event.usage.output_tokens ?? usage.outputTokens,
        }
        return
      }
      if (event?.type === 'assistant') {
        const assistantText = getAssistantText(event)
        if (!assistantText) return
        if (assistantText.startsWith(lastAssistantText)) {
          appendText(assistantText.slice(lastAssistantText.length))
        } else if (!sawTextDelta) {
          appendText(assistantText)
        }
        lastAssistantText = assistantText
        return
      }
      if (event?.type === 'result') {
        if (!sawTextDelta && typeof event.result === 'string') appendText(event.result)
        if (event.usage) {
          usage = {
            inputTokens: event.usage.input_tokens ?? usage.inputTokens,
            outputTokens: event.usage.output_tokens ?? usage.outputTokens,
          }
        }
      }
    }

    refreshTimeout()

    proc.stdout.on('data', (chunk: Buffer) => {
      refreshTimeout()
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          handleEvent(JSON.parse(line))
        } catch {
          // ignore malformed lines
        }
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      refreshTimeout()
      const text = chunk.toString().trim()
      if (text) stderrText = [stderrText, text].filter(Boolean).join('\n').slice(-4000)
    })

    proc.on('error', (err) => reject(err))

    proc.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId)
      if (buffer.trim()) {
        try {
          handleEvent(JSON.parse(buffer))
        } catch {
          // ignore trailing malformed data
        }
      }
      if (timeoutMessage) {
        reject(new Error(timeoutMessage))
        return
      }
      if (code !== 0) {
        reject(new Error(`claude process exited with code ${code}${stderrText ? `: ${stderrText}` : ''}`))
        return
      }
      resolve({ text, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
    })
  })
}

export const claudeCodeProvider: LLMProvider = {
  name: 'claude-code',

  requireKey() {
    // no-op: CLI authentication
  },

  async createMessage(params: LLMMessageParams): Promise<LLMStreamResult> {
    return spawnClaudeCode(params.model, promptFrom(params))
  },

  async streamMessage(params: LLMMessageParams, onText: (delta: string) => void): Promise<LLMStreamResult> {
    return spawnClaudeCode(params.model, promptFrom(params), onText)
  },
}
