import * as vscode from "vscode";

import * as apiKeyManager from "./services/apiKeyManager";
import * as geminiApiService from "./services/geminiApiService";
import * as ragService from "./services/ragService";
import * as webviewService from "./services/webviewService";
import * as chatSessionManager from "./services/chatSessionManager";

import { getInitialPrompt, InitialPromptContext } from "./prompts";

const SURROUNDING_LINES_COUNT = 10; // 최초 질문 시 주변 코드 참고 라인 수 길수록 좋지만? 글쎼?
const TARGET_CODE_LINES_AFTER_PIE = 5; // @pie 다음 몇 줄까지 타겟 코드로 볼 것인가

export function activate(context: vscode.ExtensionContext) {
  console.log("[Pie Bot] 확장 프로그램이 활성화되었습니다!");

  // 1. 임베딩 데이터 로드 (ragService 사용)
  ragService.loadEmbeddingsData(context);

  // 2. API 키 설정 명령어 등록 (apiKeyManager 사용)
  const setApiKeyCommand = vscode.commands.registerCommand(
    "pie-bot.setApiKey",
    () => {
      apiKeyManager.setApiKey(context);
    }
  );
  context.subscriptions.push(setApiKeyCommand);

  // 3. @pie 질문 명령어 등록
  const askPieCommand = vscode.commands.registerCommand(
    "pie-bot.askPie",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("활성화된 에디터가 없습니다.");
        return;
      }

      const apiKey = await apiKeyManager.getApiKey(context);
      if (!apiKey) {
        vscode.window.showErrorMessage(
          "[Pie Bot] Gemini API 키가 설정되지 않았습니다. 'Pie Bot: Set Gemini API Key'를 실행하여 키를 설정해주세요."
        );
        return;
      }
      if (ragService.getLoadedEmbeddingsCount() === 0) {
        vscode.window.showErrorMessage(
          "[Pie Bot] 코드 임베딩 데이터가 로드되지 않았습니다. `data/naverpay_embeddings.json` 파일을 생성했는지 확인해주세요."
        );
        return;
      }

      // 새 @pie 질문이므로 세션 초기화 (chatSessionManager 사용)
      chatSessionManager.resetSessionContextAndHistory();

      const document = editor.document;
      const selection = editor.selection;
      const activeLineNumber = selection.active.line;

      let userQueryText = ""; // @pie 뒤의 순수 질문
      let pieLineNumber = -1;
      let targetCodeForPrompt = ""; // @pie 주석과 그 아래 코드 (또는 선택 영역)

      const pieRegex = /\/\/\s*@pie\s*(.*)/i;

      // 1. 선택 영역이 있으면 선택 영역을 타겟으로
      if (!selection.isEmpty) {
        const selectedText = document.getText(selection);
        const match = selectedText.match(pieRegex);
        if (match && match[1]) {
          userQueryText = match[1].trim();
          pieLineNumber = selection.start.line;
          targetCodeForPrompt = selectedText; // 선택 영역 전체가 타겟 코드
        }
      }

      // 2. 선택 영역에 @pie가 없거나, 선택 영역이 비어있으면 현재 라인부터 위로 탐색
      if (pieLineNumber === -1) {
        for (
          let i = activeLineNumber;
          i >= Math.max(0, activeLineNumber - 5);
          i--
        ) {
          // 현재 라인 포함 위로 5줄 탐색
          const line = document.lineAt(i);
          const match = line.text.match(pieRegex);
          if (match && match[1]) {
            pieLineNumber = i;
            userQueryText = match[1].trim();
            // @pie 라인과 그 다음 TARGET_CODE_LINES_AFTER_PIE 줄을 타겟 코드로
            let targetLines = [line.text];
            for (let j = 1; j <= TARGET_CODE_LINES_AFTER_PIE; j++) {
              const nextLineIndex = pieLineNumber + j;
              if (nextLineIndex < document.lineCount) {
                targetLines.push(document.lineAt(nextLineIndex).text);
              } else {
                break;
              }
            }
            targetCodeForPrompt = targetLines.join("\n");
            break;
          }
        }
      }

      if (pieLineNumber !== -1 && userQueryText) {
        // 세션 컨텍스트 설정 (chatSessionManager 사용)
        chatSessionManager.setSessionContext({
          initialQueryText: userQueryText,
          targetCodeForPrompt: targetCodeForPrompt,
        });
        chatSessionManager.addToChatHistory({
          role: "user",
          parts: [{ text: userQueryText }],
        });

        // 웹뷰 생성/표시 (webviewService 사용)
        // webviewService.createOrShowWebviewPanel이 context를 필요로 하므로 전달
        webviewService.createOrShowWebviewPanel(context);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Pie Bot이 답변을 찾고 있습니다...",
            cancellable: false,
          },
          async (progress) => {
            progress.report({
              increment: 10,
              message: "질문을 분석 중입니다...",
            });
            const queryVector = await geminiApiService.embedQuery(
              userQueryText,
              apiKey
            );
            if (!queryVector) {
              return;
            }

            progress.report({
              increment: 30,
              message: "관련 코드를 검색 중입니다...",
            });
            const searchResults = await ragService.searchAndRerank(
              queryVector,
              userQueryText,
              apiKey
            );

            let ragContext =
              "다음 Naver Pay Dev 코드들을 참고하여 답변해주세요:\n\n";
            if (searchResults.length > 0) {
              searchResults.forEach((result, index) => {
                ragContext += `--- 참고 코드 ${index + 1} (${
                  result.repository
                }/${result.filePath}) ---\n\`\`\`\n${result.content.substring(
                  0,
                  1500
                )}\n\`\`\`\n--- 참고 코드 ${index + 1} 끝 ---\n\n`;
              });
            } else {
              ragContext =
                "참고할 만한 Naver Pay Dev 코드를 찾지 못했습니다. 일반적인 지식을 바탕으로 답변해주세요.\n\n";
            }
            chatSessionManager.setSessionContext({
              ragContextText: ragContext,
            });

            const currentFilePath = document.uri.fsPath;
            // 주변 코드 범위: @pie 라인 기준 위아래 N줄 + 타겟 코드의 실제 라인 수
            const targetCodeLineCount = targetCodeForPrompt.split("\n").length;
            const startSurroundingLine = Math.max(
              0,
              pieLineNumber - SURROUNDING_LINES_COUNT
            );
            const endSurroundingLine = Math.min(
              document.lineCount - 1,
              pieLineNumber + targetCodeLineCount - 1 + SURROUNDING_LINES_COUNT
            ); // 타겟 코드 끝나는 지점부터 아래로
            const surroundingCode = document.getText(
              new vscode.Range(
                startSurroundingLine,
                0,
                endSurroundingLine,
                document.lineAt(endSurroundingLine).text.length
              )
            );

            chatSessionManager.setSessionContext({
              editorFilePath: currentFilePath,
              editorSurroundingCode: surroundingCode.substring(0, 3000), // 프롬프트 길이 제한
            });

            const currentContextData =
              chatSessionManager.getCurrentSessionContext();

            // prompts.ts 에서 프롬프트 생성 함수 호출
            const initialPromptContext: InitialPromptContext = {
              editorFilePath: currentContextData.editorFilePath,
              editorSurroundingCode: currentContextData.editorSurroundingCode,
              targetCodeForPrompt: currentContextData.targetCodeForPrompt,
              initialQueryText: currentContextData.initialQueryText,
              ragContextText: currentContextData.ragContextText,
            };
            const promptForGemini = getInitialPrompt(initialPromptContext);

            progress.report({
              increment: 60,
              message: "Gemini에게 답변을 생성 요청 중입니다...",
            });
            const geminiAnswer = await geminiApiService.generateAnswer(
              apiKey,
              promptForGemini,
              []
            ); // 초기 질문

            progress.report({ increment: 100, message: "답변을 표시합니다." });

            if (geminiAnswer) {
              chatSessionManager.addToChatHistory({
                role: "model",
                parts: [{ text: geminiAnswer }],
              });
              webviewService.postMessageToWebview({
                type: "addMessage",
                query: currentContextData.initialQueryText,
                answer: geminiAnswer,
              });
            } else if (!geminiAnswer && webviewService.isWebviewVisible()) {
              webviewService.postMessageToWebview({
                type: "addMessage",
                query: currentContextData.initialQueryText,
                answer: "[Pie Bot] 답변을 생성하는 데 실패했습니다.",
              });
            }
          }
        );
      } else {
        vscode.window.showWarningMessage(
          "현재 라인이나 선택 영역에서 `// @pie 질문내용` 형식의 주석을 찾을 수 없습니다."
        );
      }
    }
  );
  context.subscriptions.push(askPieCommand);
}

export function deactivate() {
  console.log("[Pie Bot] 확장 프로그램이 비활성화되었습니다.");
}
