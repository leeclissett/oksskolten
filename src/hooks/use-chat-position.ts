import { createLocalStorageHook } from './create-local-storage-hook'

export type ChatPosition = 'fab' | 'inline'

const useHook = createLocalStorageHook<ChatPosition>('chat-position', 'fab', ['fab', 'inline'])

export function useChatPosition() {
  const [chatPosition, setChatPosition] = useHook()
  return { chatPosition, setChatPosition }
}
