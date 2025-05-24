import * as vscode from "vscode";
import * as fs from "fs";
import { getApiKey } from "./apiKeyManager";
import { generateAnswer } from "./geminiApiService";
import {
  getChatHistory,
  addToChatHistory,
  getCurrentSessionContext,
} from "./chatSessionManager";
import { getFollowUpPrompt, FollowUpPromptContext } from "../prompts";

let pieBotPanel: vscode.WebviewPanel | undefined = undefined;

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const nonce = getNonce();
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "webview", "style.css")
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "webview", "main.js")
  );
  const htmlFilePath = vscode.Uri.joinPath(
    extensionUri,
    "webview",
    "chat.html"
  );
  let htmlContent = "";
  try {
    htmlContent = fs.readFileSync(htmlFilePath.fsPath, "utf8");
  } catch (err) {
    console.error(
      "[Pie Bot] webview/chat.html 파일을 읽는 데 실패했습니다:",
      err
    );
    return `<html><body><h1>오류</h1><p>웹뷰 콘텐츠를 로드할 수 없습니다. webview/chat.html 파일을 확인해주세요.</p></body></html>`;
  }
  htmlContent = htmlContent.replace(/{{nonce}}/g, nonce);
  htmlContent = htmlContent.replace(/{{cspSource}}/g, webview.cspSource);
  htmlContent = htmlContent.replace(/{{styleUri}}/g, styleUri.toString());
  htmlContent = htmlContent.replace(/{{scriptUri}}/g, scriptUri.toString());
  return htmlContent;
}

export function createOrShowWebviewPanel(context: vscode.ExtensionContext) {
  const column = vscode.window.activeTextEditor
    ? vscode.window.activeTextEditor.viewColumn
    : undefined;
  if (pieBotPanel) {
    pieBotPanel.reveal(column);
    return;
  }

  pieBotPanel = vscode.window.createWebviewPanel(
    "pieBotChat",
    "Pie Bot Chat",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "webview"),
      ],
    }
  );
  pieBotPanel.webview.html = getWebviewContent(
    pieBotPanel.webview,
    context.extensionUri
  );

  pieBotPanel.onDidDispose(
    () => {
      pieBotPanel = undefined;
    },
    null,
    context.subscriptions
  );

  pieBotPanel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.type) {
        case "userFollowUp":
          const userFollowUpQuery = message.text;
          if (!userFollowUpQuery || !pieBotPanel) {
            return;
          }

          addToChatHistory({
            role: "user",
            parts: [{ text: userFollowUpQuery }],
          });
          const apiKey = await getApiKey(context);
          if (!apiKey) {
            postMessageToWebview({
              type: "addMessage",
              query: userFollowUpQuery,
              answer: "API 키가 설정되지 않았습니다.",
            });
            return;
          }

          const currentSessionCtx = getCurrentSessionContext(); // 최초 세션 컨텍스트
          const historyForAPI = getChatHistory().slice(0, -1); // 현재 사용자 질문 제외한 API용 이력

          const chatHistoryTextForPrompt = historyForAPI // 프롬프트용 문자열 이력
            .map(
              (entry) =>
                `${entry.role === "user" ? "사용자" : "Pie Bot"}: ${
                  entry.parts[0].text
                }`
            )
            .join("\n\n");

          const followUpContextData: FollowUpPromptContext = {
            editorFilePath: currentSessionCtx.editorFilePath,
            editorSurroundingCode: currentSessionCtx.editorSurroundingCode,
            targetCodeForPrompt: currentSessionCtx.targetCodeForPrompt,
            initialQueryText: currentSessionCtx.initialQueryText,
            ragContextText: currentSessionCtx.ragContextText,
            chatHistoryText: chatHistoryTextForPrompt,
            currentUserFollowUpQuery: userFollowUpQuery,
          };

          // prompts.ts의 함수를 사용하여 프롬프트 생성
          const promptForGemini = getFollowUpPrompt(followUpContextData);

          await vscode.window.withProgress(
            {
              location: { viewId: pieBotPanel.viewType || "pieBotChat" },
              title: "Pie Bot 답변 생성 중...",
            },
            async () => {
              const geminiAnswer = await generateAnswer(
                apiKey,
                promptForGemini, // 생성된 프롬프트 전달
                historyForAPI // API에는 Content[] 형식의 history 전달
              );

              if (geminiAnswer && pieBotPanel) {
                addToChatHistory({
                  role: "model",
                  parts: [{ text: geminiAnswer }],
                });
                postMessageToWebview({
                  type: "addMessage",
                  query: userFollowUpQuery,
                  answer: geminiAnswer,
                });
              } else if (!geminiAnswer && pieBotPanel) {
                postMessageToWebview({
                  type: "addMessage",
                  query: userFollowUpQuery,
                  answer: "[Pie Bot] 답변을 생성하는 데 실패했습니다.",
                });
              }
            }
          );
          return;
      }
    },
    null,
    context.subscriptions
  );
}

export function postMessageToWebview(message: any) {
  if (pieBotPanel && pieBotPanel.webview && pieBotPanel.visible) {
    pieBotPanel.webview.postMessage(message);
  }
}

export function isWebviewVisible(): boolean {
  return !!(pieBotPanel && pieBotPanel.visible);
}
