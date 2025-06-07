import type {Content} from '@google/generative-ai'

export interface SessionContextData {
    initialQueryText: string
    ragContextText: string
    editorFilePath: string
    editorSurroundingCode: string
    targetCodeForPrompt: string
}

let chatHistory: Content[] = []
let currentSessionContext: SessionContextData = {
    initialQueryText: '',
    ragContextText: '',
    editorFilePath: '',
    editorSurroundingCode: '',
    targetCodeForPrompt: '',
}

export function getChatHistory(): Content[] {
    return [...chatHistory] // 복사본 반환
}

export function addToChatHistory(entry: Content): void {
    chatHistory.push(entry)
}

export function clearChatHistory(): void {
    chatHistory = []
}

export function getCurrentSessionContext(): SessionContextData {
    return {...currentSessionContext} // 복사본 반환
}

export function setSessionContext(context: Partial<SessionContextData>): void {
    currentSessionContext = {...currentSessionContext, ...context}
}

export function resetSessionContextAndHistory(): void {
    currentSessionContext = {
        initialQueryText: '',
        ragContextText: '',
        editorFilePath: '',
        editorSurroundingCode: '',
        targetCodeForPrompt: '',
    }
    clearChatHistory()
}
