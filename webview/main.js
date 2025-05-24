(function () {
  const vscode = acquireVsCodeApi();
  const messagesDiv = document.getElementById("chat-messages");

  function escapeHtml(unsafe) {
    if (typeof unsafe !== "string") {
      return "";
    }
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatAnswerForDisplay(text) {
    let formattedText = "";
    const codeBlockRegex = /```typescript\s*([\s\S]*?)\s*```|```([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      // 코드 블록 이전의 텍스트
      formattedText += escapeHtml(
        text.substring(lastIndex, match.index)
      ).replace(/\n/g, "<br>");
      // 코드 블록
      const codeContent = match[1] || match[2]; // typescript 지정 또는 일반
      formattedText +=
        "<pre><code>" + escapeHtml(codeContent) + "</code></pre>";
      lastIndex = codeBlockRegex.lastIndex;
    }
    // 마지막 코드 블록 이후의 텍스트
    formattedText += escapeHtml(text.substring(lastIndex)).replace(
      /\n/g,
      "<br>"
    );
    return formattedText;
  }

  // 확장 프로그램으로부터 메시지 수신
  window.addEventListener("message", (event) => {
    const message = event.data; // { type: 'addMessage', query: '...', answer: '...' }

    if (message.type === "addMessage") {
      const queryDiv = document.createElement("div");
      queryDiv.className = "message user-query";
      queryDiv.innerHTML =
        "<strong>질문:</strong> " + escapeHtml(message.query);
      messagesDiv.appendChild(queryDiv);

      const answerDiv = document.createElement("div");
      answerDiv.className = "message bot-answer";
      answerDiv.innerHTML =
        "<strong>답변:</strong>" + formatAnswerForDisplay(message.answer);
      messagesDiv.appendChild(answerDiv);

      answerDiv.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  });

  const userInput = document.getElementById("user-input");
  const sendButton = document.getElementById("send-button");

  function sendMessageToExtension() {
    const messageText = userInput.value.trim();
    if (messageText) {
      // 사용자가 입력한 질문을 채팅창에 먼저 표시
      const queryDiv = document.createElement("div");
      queryDiv.className = "message user-query";
      queryDiv.innerHTML = "<strong>질문:</strong> " + escapeHtml(messageText);
      messagesDiv.appendChild(queryDiv);
      queryDiv.scrollIntoView({ behavior: "smooth", block: "end" });

      // 확장 프로그램으로 메시지 전송
      vscode.postMessage({
        type: "userFollowUp",
        text: messageText,
      });
      userInput.value = ""; // 입력창 비우기
    }
  }

  sendButton.addEventListener("click", sendMessageToExtension);

  userInput.addEventListener("keypress", function (event) {
    // Shift + Enter는 줄바꿈, 그냥 Enter는 전송
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); // 기본 Enter 동작(줄바꿈) 방지
      sendMessageToExtension();
    }
  });
})();
