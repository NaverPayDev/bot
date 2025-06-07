import {GoogleGenerativeAI, HarmCategory, HarmBlockThreshold} from '@google/generative-ai'
import * as vscode from 'vscode'

import type {Content} from '@google/generative-ai'

// TODO 최적의 모델은 무엇일까 나도 모름
const EMBEDDING_MODEL_NAME = 'embedding-001'
const GENERATIVE_MODEL_NAME = 'gemini-1.5-pro-latest'

export async function embedQuery(query: string, apiKey: string): Promise<number[] | undefined> {
    try {
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({model: EMBEDDING_MODEL_NAME})
        const result = await model.embedContent(query)
        return result.embedding.values
    } catch (error: any) {
        console.error('[Pie Bot] 질문 임베딩 오류:', error)
        vscode.window.showErrorMessage(`[Pie Bot] 질문 임베딩 중 오류 발생: ${error.message}`)
        return undefined
    }
}

export async function generateAnswer(
    apiKey: string,
    promptForThisTurn: string,
    historyForAPI: Content[],
): Promise<string | undefined> {
    try {
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({
            model: GENERATIVE_MODEL_NAME,
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
                },
            ],
        })

        const chat = model.startChat({
            history: historyForAPI,
        })

        const result = await chat.sendMessage(promptForThisTurn)
        const response = await result.response
        return response.text()
    } catch (error: any) {
        console.error('[Pie Bot] Gemini API 호출 오류:', error)
        vscode.window.showErrorMessage(`[Pie Bot] Gemini API 호출 중 오류 발생: ${error.message}`)
        return undefined
    }
}

export async function scoreRelevance(
    apiKey: string,
    userQuery: string,
    candidateText: string,
): Promise<number | undefined> {
    try {
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({model: GENERATIVE_MODEL_NAME})
        const prompt = `다음 질문과 코드 스니펫의 관련도를 0과 1 사이의 숫자로만 답해주세요.\n\n질문: ${userQuery}\n\n코드:\n${candidateText}\n`
        const result = await model.generateContent(prompt)
        const text = (await result.response).text().trim()
        const match = text.match(/\d+(?:\.\d+)?/)
        if (match) {
            return Number.parseFloat(match[0])
        }
        return undefined
    } catch (error: any) {
        console.error('[Pie Bot] Gemini 관련도 평가 오류:', error)
        return undefined
    }
}
