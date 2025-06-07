export interface InitialPromptContext {
  editorFilePath: string;
  editorSurroundingCode: string;
  targetCodeForPrompt: string;
  initialQueryText: string;
  ragContextText: string;
}

export interface FollowUpPromptContext {
  editorFilePath: string;
  editorSurroundingCode: string;
  targetCodeForPrompt: string;
  initialQueryText: string;
  ragContextText: string;
  chatHistoryText: string;
  currentUserFollowUpQuery: string;
}

interface CombinedPromptBuilderContext {
  editorFilePath: string;
  editorSurroundingCode: string;
  targetCodeForPrompt: string; // 최초 질문 시의 타겟 코드 (@pie 주석 포함)
  initialQueryText: string; // 최초 @pie 질문의 순수 텍스트
  ragContextText: string; // 최초 질문 시의 RAG 결과 텍스트
  currentUserQuery: string; // 현재 답변해야 할 사용자의 실제 질문 텍스트
  chatHistoryText?: string; // 후속 질문 시 이전 대화 내용 (문자열)
}

/**
 * 모든 프롬프트의 공통적인 구조와 지침을 생성하는 내부 함수
 * @param context 통합 컨텍스트
 * @param isFollowUp 후속 질문 여부
 * @returns 완성된 프롬프트 문자열
 */
function buildPromptTemplate(
  context: CombinedPromptBuilderContext,
  isFollowUp: boolean
): string {
  const persona =
    "당신은 'Pie Bot'입니다. github.com/naverpaydev 코드 전문가이며 자바스크립트/타입스크립트 최고 전문가입니다.";

  const sections: string[] = [persona];

  sections.push(
    `**현재 사용자 작업 환경${isFollowUp ? " (최초 질문 시점)" : ""}:**`,
    `* **파일 경로:** ${context.editorFilePath}`,
    `* **주변 코드${isFollowUp ? " (최초 질문 시점)" : ""}:**`,
    "```typescript",
    context.editorSurroundingCode,
    "```"
  );

  sections.push(
    `**${
      isFollowUp ? "최초 질문 시 " : ""
    }사용자가 수정을 원했던 코드 및 질문:**`,
    "```typescript",
    context.targetCodeForPrompt,
    "```",
    `// @pie ${context.initialQueryText}`
  );

  sections.push(
    `**${isFollowUp ? "최초 질문 시 " : ""}참고 자료 (Naver Pay Dev 코드):**`,
    context.ragContextText
  );

  if (isFollowUp && context.chatHistoryText) {
    sections.push("**이전 대화 내용:**", context.chatHistoryText);
  }

  const instructions = [
    "위 코드와 참고 자료를 참고해 구체적인 수정 예시를 제시하세요.",
    "**사용자가 바로 쓸 수 있는 완전한 코드**를 제공하고 필요한 `import`를 명확히 포함합니다. (단 `src` 경로는 사용하지 마세요)",
    "코드는 ESModule 형식으로 작성하고 답변은 간결해야 합니다.",
    "항상 사용자 코드 개선에 집중하세요.",
    "npm 또는 pnpm만 사용하고 yarn은 언급하지 마세요.",
    '제공된 정보에 없는 `@naverpay` 명칭은 사용하지 말고, 찾을 수 없으면 "정보 내에서 찾을 수 없습니다"라고 답변합니다.',
  ];
  if (isFollowUp) {
    instructions.push("패키지 관련 질문이 있다면 README를 참고해 답하세요.");
  }

  const numbered = instructions
    .map((inst, idx) => `${idx + 1}. ${inst}`)
    .join("\n");

  sections.push("**지침**", numbered);

  sections.push(
    `---\n위 지침에 따라 ${isFollowUp ? "마지막 " : ""}사용자 질문(\"${
      context.currentUserQuery
    }\")에 답하세요.`
  );

  return sections.join("\n");
}

/**
 * 초기 질문 시 사용할 프롬프트를 생성합니다.
 */
export function getInitialPrompt(context: InitialPromptContext): string {
  const combinedContext: CombinedPromptBuilderContext = {
    editorFilePath: context.editorFilePath,
    editorSurroundingCode: context.editorSurroundingCode,
    targetCodeForPrompt: context.targetCodeForPrompt,
    initialQueryText: context.initialQueryText,
    ragContextText: context.ragContextText,
    currentUserQuery: context.initialQueryText,
    // chatHistoryText는 없음
  };
  return buildPromptTemplate(combinedContext, false);
}

/**
 * 후속 질문 시 사용할 프롬프트를 생성합니다.
 */
export function getFollowUpPrompt(context: FollowUpPromptContext): string {
  const combinedContext: CombinedPromptBuilderContext = {
    editorFilePath: context.editorFilePath,
    editorSurroundingCode: context.editorSurroundingCode,
    targetCodeForPrompt: context.targetCodeForPrompt,
    initialQueryText: context.initialQueryText,
    ragContextText: context.ragContextText,
    currentUserQuery: context.currentUserFollowUpQuery,
    chatHistoryText: context.chatHistoryText,
  };
  return buildPromptTemplate(combinedContext, true);
}
