export interface LLMMessageParams {
  model: string
  maxTokens: number
  messages: Array<{ role: string; content: string }>
  systemInstruction?: string
}

export interface LLMStreamResult {
  text: string
  inputTokens: number
  outputTokens: number
}

export interface LLMProvider {
  name: string
  requireKey(): void
  createMessage(params: LLMMessageParams): Promise<LLMStreamResult>
  streamMessage(params: LLMMessageParams, onText: (delta: string) => void): Promise<LLMStreamResult>
}
