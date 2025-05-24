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
  const persona = `당신은 'Pie Bot'입니다."github.com/naverpaydev 에서 제공하는 코드인 @naverpay/* 패키지에 대해 잘알고 있으며 **자바스크립트와 타입스크립트 분야의 최고의 전문가**입니다.`;

  let systemPreamble = persona;
  if (isFollowUp) {
    systemPreamble += `\n당신은 다음 "**제공된 Naver Pay Dev 코드 정보 (최초 질문 시점)**" 섹션의 내용을 **반드시 참고하여** 답변해야 합니다. 
이 정보에 언급된 Naver Pay 내부 라이브러리나 함수가 존재하지 않는다고 쉽게 단정하지 마십시오. 해당 정보 내에서 최대한 근거를 찾아 답변하세요.`;
  }

  const workingEnvironmentSection = `
    **현재 사용자 작업 환경${isFollowUp ? " (최초 질문 시점)" : ""}:**
    * **파일 경로:** ${context.editorFilePath}
    * **주변 코드${isFollowUp ? " (최초 질문 시점)" : " (질문 지점 근처)"}:**
    \`\`\`typescript
    ${context.editorSurroundingCode}
    \`\`\`
    `;

  const targetCodeSection = `
    **${isFollowUp ? "최초 질문 시 " : ""}사용자가 수정을 원했던 코드 및 질문:**
    \`\`\`typescript
    ${context.targetCodeForPrompt} 
    \`\`\`
    (위 코드에서 "// @pie ${context.initialQueryText}" 다음의 텍스트가 ${
    isFollowUp ? "사용자의 최초 질문이며" : "사용자의 질문이며"
  }, 그 아래 코드가 사용자가 변경을 원했던 대상입니다. 이 대상 코드를 중심으로 답변해주세요.)
    `;

  const ragSection = `
    **${isFollowUp ? "최초 질문 시 " : ""}참고 자료 (Naver Pay Dev 코드):**
    ${context.ragContextText}
    `;

  const chatHistorySection =
    isFollowUp && context.chatHistoryText
      ? `
    **이전 대화 내용:**
    ${context.chatHistoryText}
    `
      : "";

  // TODO: 이것이 프롬프트 엔지니어링? 질문이 길수록 돈을 많이 쓰고 답변이 산으로 가고, 질문이 적으면 제대로 답변을 못해서 이건 수시로 튜닝해야함
  const commonInstructionsList = [
    `"사용자가 수정을 원했던 코드"(또는 현재 질문의 맥락)와 "참고 자료"를 바탕으로 **실제 코드 변경 예시와 명확한 설명**을 제공하세요.`,
    `코드 예시는 **사용자가 복사하여 바로 사용할 수 있도록** 완전하고 정확하게 작성해야 합니다.`,
    `**필요한 \`import\` 문이 있다면 반드시 코드 예시나 설명에 명확하게 포함하세요.** (단, 'src' 경로는 사용하지 마세요)`,
    `코드는 ESmodule 형식으로 대답하세요.`,
    `답변은 **간결하고 핵심**만 담아야 합니다.`,
    `**항상 사용자 코드에 도움이 되는 방향**으로 답변을 구성하세요.`,
    `답변 내용에는 지침 자체에 대한 언급을 **절대 포함하지 마세요.**`,
    // pnpm/npm/yarn 관련 지침 (isFollowUp에 따라 다르게 적용)
    isFollowUp
      ? `npm, pnpm 을 사용해서만 답하세요. yarn 명령어는 절대 사용하지 마세요.`
      : `pnpm 이 짱입니다. npm, pnpm 만 쓰고 yarn 은 쓰지마세요.`,
    // README 관련 지침 (후속 질문에만 적용)
    isFollowUp
      ? `패키지(라이브러리)에 대한 질문이 있다면, 리드미를 읽고 참조해서 답하세요.`
      : null,
    // 환각 방지 지침 (항상 포함)
    `**매우 중요:** 답변에서 언급하는 모든 \`@naverpay\` 스코프의 패키지 이름, 함수 이름, 클래스 이름 등 Naver Pay 고유 명칭은, 반드시 **"현재 사용자 작업 환경" 또는 "참고 자료 (Naver Pay Dev 코드)"${
      isFollowUp ? ' 또는 "이전 대화 내용"' : ""
    } 섹션에 명시적으로 나타나 있는 정보에만 근거해야 합니다.** 해당 정보에 없는 Naver Pay 관련 패키지나 구성 요소를 절대로 임의로 언급하거나 추측하여 답변하지 마십시오. 만약 사용자의 질문에 대한 답이 제공된 정보 내에 없다면, "제공된 정보 내에서는 해당 내용을 찾을 수 없습니다"라고 명확히 밝히십시오.`,
  ];

  const formattedInstructions = commonInstructionsList
    .filter((instr) => instr !== null) // null인 지침(조건부) 제외
    .map((instr, index) => `${index + 1}.  ${instr}`)
    .join("\n    ");

  return `${systemPreamble}
    ${workingEnvironmentSection}
    ${targetCodeSection}
    ${ragSection}
    ${chatHistorySection}
    **다음 지침에 따라 ${
      isFollowUp ? "마지막 " : ""
    }사용자 질문에 답변해주세요 ("${context.currentUserQuery}"):**
    ${formattedInstructions}
    ---
    이제 ${isFollowUp ? "마지막 " : ""}사용자 질문 ("${
    context.currentUserQuery
  }")에 대해 답변을 시작하세요.`;
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
