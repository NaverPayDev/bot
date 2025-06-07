import * as vscode from 'vscode'

const API_KEY_SECRET_ID = 'pieBotGeminiApiKey'

export async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
    const apiKey = await vscode.window.showInputBox({
        prompt: 'Google AI Studio에서 발급받은 Gemini API 키를 입력해주세요.',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'API 키를 여기에 붙여넣으세요...',
    })

    if (apiKey) {
        await context.secrets.store(API_KEY_SECRET_ID, apiKey)
        vscode.window.showInformationMessage('[Pie Bot] Gemini API 키가 성공적으로 저장되었습니다!')
    } else {
        vscode.window.showWarningMessage('[Pie Bot] API 키 입력이 취소되었습니다.')
    }
}

export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    return await context.secrets.get(API_KEY_SECRET_ID)
}
