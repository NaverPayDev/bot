# 🥧 Pie Bot (가제)

Pie Bot은 Gemini AI 모델을 기반으로 하는 VSCode 확장 프로그램입니다. 프론트엔드개발자들이 `github.com/naverpaydev` 에 있는 내부 코드베이스와 관련된 질문을 하고, 코드 이해, 작성, 리팩토링에 대한 도움을 받을 수 있도록 설계되었습니다.

## 🤔 프로젝트 필요성과 기대 효과

Naver Pay 조직의 코드베이스는 크고 복잡해 필요한 파일이나 예제를 찾기 어렵습니다. Pie Bot은 질문 한 번으로 관련 코드를 검색하고 설명을 제공해 개발 속도를 높여 줍니다. 또한 반복적인 코드 리뷰나 리팩터링 조언을 자동화하여 팀 생산성 향상에 기여합니다.

## ✨ 주요 기능

- VSCode 편집기 내에서 `// @pie` 주석을 사용하여 질문합니다.
- 별도의 "Pie Bot Chat" 웹뷰 패널을 통해 AI와 대화형으로 상호작용합니다.
- 후속 질문을 통해 이전 답변에 대한 추가 정보를 얻거나 대화를 이어갈 수 있습니다.
- 현재 편집 중인 파일의 내용, 커서 주변 코드, 그리고 사전 처리된 Naver Pay Dev 코드 임베딩 데이터를 종합하여 맥락에 맞는 답변을 제공합니다.
- `src/prompts.ts` 파일을 통해 AI의 응답 방식과 페르소나를 유연하게 조정할 수 있습니다.

## ⚙️ 동작 방식

Pie Bot은 다음과 같은 단계로 사용자의 질문을 처리하고 답변을 생성합니다.

1. **사용자 입력 감지 (`// @pie` 트리거):**
   - 개발자가 VSCode 편집기 내 코드에 `// @pie 질문내용` 형식의 주석을 작성하고 명령을 실행하면, Pie Bot이 활성화됩니다.
2. **컨텍스트 수집:**
   - **에디터 컨텍스트:** 현재 열려있는 파일의 경로, `@pie` 주석 주변의 코드, 사용자가 질문과 함께 지목한 "타겟 코드"를 수집합니다.
   - **RAG (Retrieval Augmented Generation - 검색 증강 생성):**
     - **사전 준비 (임베딩 데이터 생성):**
       - `scripts/embed_naverpay_code.js` 스크립트를 사용하여 지정된 Naver Pay Dev GitHub 저장소들의 코드를 로컬에 클론합니다.
       - 각 코드 파일을 의미 단위(현재는 파일 단위)로 분할하고, Gemini의 `embedding-001` 모델을 사용하여 텍스트를 벡터로 변환(임베딩)합니다.
       - 생성된 벡터와 원본 코드 및 메타데이터(저장소 이름, 파일 경로)를 `data/naverpay_embeddings.json` 파일에 저장합니다. 이 작업은 주기적으로 또는 코드베이스 변경 시 수행해야 합니다.
     - **실시간 검색 (질문 시):**
       - 사용자의 질문(`@pie` 뒤의 텍스트)도 동일한 임베딩 모델을 사용하여 벡터로 변환합니다.
       - `naverpay_embeddings.json`에 저장된 모든 코드 벡터와 질문 벡터 간의 코사인 유사도(Cosine Similarity)를 계산합니다.
       - 유사도가 높은 상위 N개의 코드 조각을 1차로 선택한 후, Reranking 로직(키워드 일치 보너스, 테스트 코드 페널티 등)을 적용하여 최종 참고 자료를 선정합니다.
3. **프롬프트 구성:**
   - 수집된 에디터 컨텍스트, RAG 검색 결과(참고 자료), 이전 대화 이력(후속 질문 시), 그리고 `src/prompts.ts`에 정의된 시스템 지침(AI의 역할, 답변 스타일, 제약 조건 등)을 종합하여 Gemini 생성형 모델에게 전달할 최종 프롬프트를 동적으로 구성합니다.
4. **LLM 상호작용 (답변 생성):**
   - 구성된 프롬프트를 Google Gemini API (`gemini-1.5-pro-latest` 또는 설정된 다른 모델)로 전송합니다.
   - Gemini 모델이 프롬프트를 이해하고 답변을 생성합니다.
5. **결과 표시:**
   - 생성된 답변을 VSCode 내 "Pie Bot Chat" 웹뷰 패널에 표시하여 사용자가 확인할 수 있도록 합니다.

## 🛠️ 사용된 주요 기술 및 기법

Pie Bot은 다음과 같은 주요 기술과 기법을 활용하여 구현되었습니다.

### 1. VSCode 확장 프로그램 API (VSCode Extension API)

VSCode가 제공하는 API를 사용하여 편집기 환경과 긴밀하게 통합됩니다.

- **명령어 (Commands API):** `// @pie` 주석 기반의 사용자 요청을 처리하기 위해 명령어를 등록(`vscode.commands.registerCommand`)하고 실행합니다.
- **웹뷰 (Webview API):** "Pie Bot Chat" 패널과 같은 사용자 정의 UI를 HTML, CSS, JavaScript를 사용하여 구현합니다 (`vscode.window.createWebviewPanel`). 확장 프로그램의 Node.js 백엔드와 웹뷰 간의 양방향 메시지 통신(`postMessage`, `onDidReceiveMessage`)도 이 API를 통해 이루어집니다.
- **SecretStorage API:** 사용자의 Gemini API 키와 같이 민감한 정보를 운영체제의 안전한 저장소에 보관하고 불러옵니다 (`vscode.ExtensionContext.secrets`).
- **TextEditor API & Document API:** 현재 활성화된 편집기의 텍스트 내용, 커서 위치, 선택 영역, 파일 경로 등의 정보를 가져와 AI에게 맥락으로 제공합니다 (`vscode.window.activeTextEditor`, `vscode.TextDocument`).
- **Window API:** 정보/오류/경고 메시지 표시 (`vscode.window.showInformationMessage`), 진행 상태 알림 (`vscode.window.withProgress`) 등을 사용하여 사용자에게 피드백을 제공합니다.

### 2. 대규모 언어 모델 (Large Language Models - LLM)

Google의 Gemini 모델을 핵심 엔진으로 사용합니다.

- **모델 종류:** 현재 코드에는 답변 생성에 `gemini-1.5-pro-latest` (또는 `src/services/geminiApiService.ts`에 설정된 다른 Gemini 모델)가, 텍스트 임베딩에는 `embedding-001` 모델이 사용됩니다.
- **API 호출:** `@google/generative-ai` Node.js SDK를 통해 Gemini API와 안전하고 효율적으로 통신합니다.
- **주요 작업:**
  - **텍스트 생성 (Text Generation):** 사용자의 질문과 풍부한 컨텍스트(코드, RAG 결과, 대화 이력)를 바탕으로 자연스러운 설명과 정확한 코드 예시를 생성합니다.
  - **문맥 이해 (Context Understanding):** 긴 프롬프트에 포함된 다양한 정보(시스템 지침, 현재 코드 맥락, 참고 코드, 이전 대화)를 종합적으로 이해하고, 이를 바탕으로 사용자의 의도에 맞는 답변을 생성하려고 노력합니다.
- **안전 설정 (Safety Settings):** API 호출 시 유해 콘텐츠(괴롭힘, 증오심 표현, 성적으로 노골적인 내용, 위험한 콘텐츠)를 차단하기 위한 기본 안전 설정이 적용됩니다.

### 3. 검색 증강 생성 (Retrieval Augmented Generation - RAG)

Pie Bot이 Naver Pay 개발 환경의 방대한 코드베이스에 대한 "특화된 지식"을 갖도록 하는 핵심 기법입니다. 이를 통해 LLM의 일반적인 지식에 특정 도메인(Naver Pay 코드)의 정보를 결합하여 답변의 정확성과 관련성을 크게 향상시킵니다.

- **1. 데이터 준비 (Embedding Pipeline - `scripts/embed_naverpay_code.js`):**
  - **소스 코드 수집:** 개발자가 지정한 Naver Pay Dev GitHub 저장소들을 로컬 환경으로 복제합니다.
  - **청킹 (Chunking):** 각 소스 코드 파일을 함수 또는 클래스 단위의 작은 블록으로 분할하여 임베딩합니다. 각 청크에는 저장소 이름과 파일 경로는 물론 추출된 심볼명까지 메타데이터로 포함됩니다.
  - **텍스트 임베딩 (Text Embedding):** 각 코드 청크(파일 내용 + 메타데이터 일부)를 Gemini의 `embedding-001` 모델을 사용하여 고차원의 벡터(숫자 배열)로 변환합니다. 이 벡터는 해당 텍스트의 의미론적 내용을 압축적으로 표현하며, 의미적으로 유사한 텍스트는 벡터 공간에서 서로 가깝게 위치하게 됩니다.
  - **저장:** 생성된 임베딩 벡터와 원본 텍스트, 메타데이터를 `data/naverpay_embeddings.json` 파일에 저장합니다. 이 JSON 파일이 Pie Bot의 "지식 베이스" 역할을 하며, 필요시 주기적으로 업데이트해야 합니다.
- **2. 검색 및 증강 (Runtime - `src/services/ragService.ts`):**
  - **사용자 질문 임베딩:** 사용자가 `@pie`로 입력한 질문 텍스트도 코드 청크와 동일한 `embedding-001` 모델을 사용하여 질문 벡터로 변환합니다.
  - **벡터 검색 (Vector Search):**
    - 생성된 질문 벡터와 `naverpay_embeddings.json`에 저장된 모든 코드 벡터 간의 **코사인 유사도(Cosine Similarity)**를 계산합니다. 코사인 유사도는 두 벡터가 이루는 각도의 코사인 값으로, 두 벡터가 얼마나 같은 방향을 가리키는지를 측정합니다 (-1에서 1 사이의 값, 1에 가까울수록 유사).
    - 기본적으로 `hnswlib-node` 기반의 **VectorIndex**를 이용해 빠른 근사 최근접 검색을 수행합니다. 인덱스 생성을 사용할 수 없는 경우에는 모든 벡터를 순차적으로 비교하는 브루트포스 방식으로 동작합니다.
  - **Reranking (순위 재조정):**
    - 단순 코사인 유사도만으로는 사용자의 실제 의도와 가장 적합한 결과를 찾기 어려울 수 있습니다. 따라서 1차적으로 유사도가 높은 상위 N개의 결과를 선별한 후, 추가적인 휴리스틱 규칙을 적용하여 결과의 순위를 재조정합니다.
    - **적용되는 휴리스틱 규칙:**
      - 사용자 질문에 포함된 주요 키워드가 검색된 코드 조각의 파일 경로(`filePath`) 또는 내용(`content`)에 나타나면 가산점을 부여합니다.
      - 테스트 관련 파일(경로에 `test`, `spec`, `mock` 등이 포함)에는 감점을 부여하여, 실제 구현 코드나 문서가 우선적으로 참고되도록 합니다.
      - `src` 폴더 내부에 깊숙이 위치한 파일보다는 `index.ts`나 `index.js`와 같이 패키지 또는 모듈의 주요 진입점에 해당하는 파일에 가산점을 부여하여, 라이브러리 사용 관점에서 더 유용한 정보가 선택될 확률을 높입니다.
      - 이렇게 재조정된 점수를 기준으로 결과를 정렬한 뒤, 상위 일부 후보에 대해서는 Gemini 모델을 이용해 질문과 코드의 관련도를 0~1 사이의 숫자로 재평가합니다. 이 점수를 기존 휴리스틱 점수와 7:3 비율로 합산하여 최종 순위를 결정합니다.
      - 최종적으로 선정된 Top-K개의 가장 관련성 높은 코드 조각을 "참고 자료(RAG 컨텍스트)"로 사용합니다.
  - **프롬프트에 증강:** 선택된 참고 자료들을 LLM에게 전달할 최종 프롬프트에 포함시켜, LLM이 답변을 생성할 때 풍부한 내부 코드 정보를 활용하도록 합니다.

### 4. 프롬프트 엔지니어링 (Prompt Engineering)

LLM이 사용자의 의도를 정확히 파악하고, 원하는 형식과 내용으로 고품질의 답변을 생성하도록 유도하기 위해 프롬프트를 체계적으로 설계하고 지속적으로 개선합니다. (`src/prompts.ts` 파일에서 관리)

- **역할 부여 (Persona):** Pie Bot에게 "Naver Pay Dev 코드 전문가", "자바스크립트/타입스크립트 최고 전문가"와 같은 구체적인 역할을 부여하여 답변의 전문성과 일관된 톤을 유지하도록 합니다.
- **명확하고 구체적인 지시사항:** AI가 따라야 할 행동 지침(예: 코드 생성 형식, 답변 스타일, 정보 인용 방식, 금지 사항)을 명시적으로 제공합니다. 특히, `@naverpay` 스코프의 명칭을 사용할 때는 반드시 제공된 컨텍스트(RAG 결과, 에디터 내용)에 근거하도록 하여 환각(Hallucination)을 최소화하려는 지침이 포함됩니다.
- **컨텍스트 구조화 및 주입:** 사용자의 현재 작업 환경(현재 열람 중인 파일 경로, 커서 주변 코드), 사용자가 `@pie` 주석으로 직접 지목한 "타겟 코드", RAG 시스템을 통해 검색된 "참고 자료", 이전 대화 이력(후속 질문 시) 등 다양한 맥락 정보를 구조화하여 프롬프트에 포함시킵니다.
- **구조화된 프롬프트 형식:** 정보를 논리적인 섹션(예: "현재 사용자 작업 환경", "참고 자료", "지침")으로 나누고, Markdown 문법 등을 활용하여 LLM이 프롬프트의 각 부분을 더 잘 이해하고 활용하도록 돕습니다.
- **반복적 개선:** Pie Bot의 실제 답변을 관찰하고 사용자의 피드백을 반영하여 프롬프트 내용을 지속적으로 수정하고 최적화합니다.

### 5. 기타 개발 환경

- **Node.js & TypeScript:** VSCode 확장 프로그램 개발의 표준적인 환경으로, 타입 시스템을 통해 코드의 안정성을 높이고 개발 생산성을 향상시킵니다.
- **HTML, CSS, JavaScript (Webview):** "Pie Bot Chat" 패널과 같은 사용자 정의 인터페이스를 구현하는 데 사용됩니다. 웹뷰는 VSCode 내에서 독립적인 웹 콘텐츠를 렌더링할 수 있게 해줍니다.
- **`pnpm`:** 빠르고 디스크 공간을 효율적으로 사용하는 의존성 관리를 위해 선택된 패키지 매니저입니다.

## 🚀 개발 환경 설정 및 시작하기

다른 개발자와 함께 Pie Bot을 개발하거나 로컬 환경에서 실행하려면 다음 단계를 따르세요.

1. **사전 요구 사항:**
   - Node.js (v22 이상 권장)
   - `pnpm` (Node.js 설치 후 `npm install -g pnpm`으로 설치)
2. **저장소 복제:**

   ```bash
   git clone <pie-bot-repository-url>
   cd pie-bot
   ```

3. **의존성 설치:**

   ```bash
   pnpm install
   ```

4. **API 키 설정:**

   - 프로젝트 루트 디렉토리에 `.env` 파일을 생성합니다.
   - `.env` 파일 안에 다음과 같이 Gemini API 키를 입력합니다. (Google AI Studio에서 발급)

     ```bash
     GEMINI_API_KEY=여러분의_Google_AI_Studio_API_키
     ```

5. **임베딩 데이터 생성 (Naver Pay Dev 코드 학습):**

   - 이 단계는 Pie Bot이 Naver Pay 코드를 이해하고 답변하는 데 **필수적**입니다.
   - `scripts/embed_naverpay_code.js` 파일을 엽니다.
   - `NAVERPAY_REPOS` 배열을 수정하여, 분석하고자 하는 Naver Pay Dev GitHub 저장소들의 **로컬 클론 경로**를 정확하게 입력합니다.

     ```javascript
     // scripts/embed_naverpay_code.js 상단 예시
     const NAVERPAY_REPOS = [
       {
         name: "@naverpay/hidash",
         path: "/Users/여러분의ID/개발폴더/hidash",
       },
       // ... 분석할 모든 저장소 경로 추가 ...
     ];
     ```

   - **팁:** 답변 품질 향상을 위해 각 라이브러리의 `.d.ts` (타입 선언 파일), `README.md`, `index.ts` (또는 메인 export 파일), `package.json` 등이 임베딩 대상에 포함되도록 `embed_naverpay_code.js`의 `RELEVANT_EXTENSIONS`와 `IGNORE_PATTERNS`를 확인/조정하세요.
   - 터미널에서 다음 명령어를 실행하여 `data/naverpay_embeddings.json` 파일을 생성합니다. (저장소 크기에 따라 시간이 소요될 수 있습니다.)

     ```bash
     node scripts/embed_naverpay_code.js
     ```

6. **확장 프로그램 빌드 및 실행 (VSCode):**
   - VSCode에서 Pie Bot 프로젝트 폴더를 엽니다.
   - 터미널에서 `pnpm run compile`을 실행하거나, 자동 빌드를 위해 `pnpm run watch`를 실행합니다.
   - VSCode의 "실행 및 디버그" 패널(좌측 벌레 아이콘)로 이동하여, 상단의 실행 구성을 "Run Extension"으로 선택하고 초록색 재생(▶️) 버튼을 클릭합니다 (또는 F5 키).
   - 새로운 "확장 개발 호스트" VSCode 창이 열립니다.
7. **Pie Bot API 키 설정 (확장 개발 호스트 창에서):**
   - "확장 개발 호스트" 창에서 명령어 팔레트(`Cmd+Shift+P` 또는 `Ctrl+Shift+P`)를 엽니다.
   - "Pie Bot: Set Gemini API Key" 명령을 검색하여 실행하고, `.env` 파일에 입력했던 것과 동일한 API 키를 입력합니다.

## 💡 Pie Bot 사용 방법 (확장 개발 호스트 창에서)

1. 코드 파일을 엽니다.
2. 궁금한 내용이나 코드 변경 요청이 있는 라인에 커서를 두고 `// @pie` 주석과 함께 질문을 작성합니다.

   ```javascript
   // @pie 이 함수를 hidash의 throttle로 바꾸고 싶어
   function handleClick() {
     /* ... */
   }
   ```

3. 해당 라인에서 단축키 (`Cmd+Alt+P` 또는 `Ctrl+Alt+P`)를 누르거나, 우클릭 후 컨텍스트 메뉴에서 "Ask Pie (@pie)"를 선택합니다.
4. VSCode 에디터 옆에 "Pie Bot Chat" 패널이 열리거나 활성화되며, 질문과 함께 Pie Bot의 답변이 표시됩니다.
5. 채팅 패널 하단의 입력창을 사용하여 후속 질문을 하고 대화를 이어갈 수 있습니다.
6. Pie Bot이 제안하는 코드는 채팅창에서 복사하여 직접 코드에 적용합니다.

## 🤖 주요 AI 및 관련 개념 설명

Pie Bot은 최신 AI 기술을 활용합니다.

### 1. LLM (Large Language Models / 대규모 언어 모델)

- **설명:** LLM은 방대한 양의 텍스트 데이터를 학습하여 인간과 유사한 방식으로 언어를 이해하고, 요약하고, 번역하고, 예측하고, 생성할 수 있는 인공지능 모델입니다.
- **Pie Bot 적용:** Pie Bot은 Google의 Gemini 모델을 LLM으로 사용합니다. 사용자의 질문, 코드 맥락, 검색된 참고 자료 등을 이해하고, 이를 바탕으로 유용한 설명과 코드 예시를 생성하는 핵심 두뇌 역할을 합니다.
- **더 알아보기:**
  - [세계적 수준의 Google AI를 기반으로 한 대규모 언어 모델](https://cloud.google.com/ai/llms?hl=ko)
  - [Large language model (Wikipedia)](https://en.wikipedia.org/wiki/Large_language_model)

### 2. RAG (Retrieval Augmented Generation / 검색 증강 생성)

- **설명:** RAG는 LLM이 답변을 생성할 때, LLM 자체의 학습된 지식뿐만 아니라 외부의 특정 문서나 데이터베이스에서 관련된 정보를 실시간으로 검색(Retrieve)하여 이 정보를 LLM에게 함께 제공(Augment)함으로써 답변의 정확성과 관련성을 높이는 기술입니다.
- **Pie Bot 적용:** Pie Bot은 Naver Pay Dev 코드베이스에 대한 특화된 지식을 갖기 위해 RAG를 사용합니다.
  1. **데이터 준비:** `scripts/embed_naverpay_code.js`를 통해 Naver Pay Dev 코드 저장소의 내용을 임베딩하여 `data/naverpay_embeddings.json`이라는 지식 베이스를 구축합니다.
  2. **검색:** 사용자의 질문이 들어오면, 이 지식 베이스에서 질문과 가장 관련된 코드 조각들을 검색합니다.
  3. **증강 및 생성:** 검색된 코드 조각들을 현재 편집기 컨텍스트와 함께 Gemini 모델에게 전달하여, Naver Pay 코드에 특화된 답변을 생성하도록 합니다.
- **더 알아보기:**
  - [Retrieval Augmented Generation (RAG) (Pinecone)](https://www.pinecone.io/learn/retrieval-augmented-generation/)
  - [RAG(검색 증강 생성)란? – LLM 단점을 보완하는 기술](https://modulabs.co.kr/blog/retrieval-augmented-generation)
  - [Retrieval Augmented Generation (RAG) Concepts (Langchain Docs)](https://python.langchain.com/v0.2/docs/concepts/#retrieval-augmented-generation-rag)

### 3. 텍스트 임베딩 (Text Embeddings)

- **설명:** 텍스트(코드, 문장 등)를 의미론적 정보를 담고 있는 숫자 벡터(Vector, 숫자의 배열)로 변환하는 과정입니다. 의미가 비슷한 텍스트는 벡터 공간에서 서로 가까운 위치에 표현됩니다.
- **Pie Bot 적용:** Naver Pay Dev 코드의 각 파일(청크)과 사용자의 질문을 Gemini의 `embedding-001` 모델을 사용해 벡터로 만듭니다. 이를 통해 의미 기반의 검색이 가능해집니다.
- **더 알아보기:**
  - [Embeddings Guide (Google AI for Developers)](https://ai.google.dev/docs/embeddings_guide)
  - [What are Embeddings? (Hugging Face Blog - 영어지만 그림 설명 좋음)](https://huggingface.co/blog/getting-started-with-embeddings)

### 4. 벡터 검색 (Vector Search)

- **설명:** 주어진 질문 벡터와 가장 유사한 벡터들을 데이터베이스에서 찾는 과정입니다.
- **Pie Bot 적용:** 사용자의 질문 벡터를 기준으로, `data/naverpay_embeddings.json`에 저장된 수많은 코드 벡터들 중에서 가장 의미적으로 유사한 코드 조각(벡터)들을 찾아냅니다. 현재는 코사인 유사도를 사용하여 모든 저장된 벡터와 비교하는 방식으로 구현되어 있습니다.
- **더 알아보기:**
  - [What is vector search? (Elastic)](https://www.elastic.co/what-is/vector-search)
  - [벡터 검색 이란 무엇인가요](https://www.ibm.com/kr-ko/think/topics/vector-search)

### 5. 코사인 유사도 (Cosine Similarity)

- **설명:** 두 벡터 간의 유사성을 측정하는 방법 중 하나로, 두 벡터 사이 각도의 코사인 값을 계산합니다. 값은 -1에서 1 사이이며, 1에 가까울수록 두 벡터가 가리키는 방향이 유사하다는 의미입니다.
- **Pie Bot 적용:** 벡터 검색 단계에서 질문 벡터와 코드 벡터가 얼마나 의미적으로 유사한지를 판단하는 기준으로 사용됩니다.
- **더 알아보기:**
  - [코사인 유사도 (위키백과)](https://ko.wikipedia.org/wiki/%EC%BD%94%EC%82%AC%EC%9D%B8_%EC%9C%A0%EC%82%AC%EB%8F%84)
  - [코사인 유사도](https://wikidocs.net/24603)

### 6. 프롬프트 엔지니어링 (Prompt Engineering)

- **설명:** LLM에게 원하는 결과를 얻어내기 위해 입력(프롬프트)을 효과적으로 설계하고 구성하는 기술입니다. AI의 역할 정의, 명확한 지시, 필요한 정보(컨텍스트) 제공, 출력 형식 지정 등이 포함됩니다.
- **Pie Bot 적용:** `src/prompts.ts` 파일에 정의된 프롬프트들은 Pie Bot의 페르소나, 답변 스타일, 참고해야 할 정보(RAG 결과, 에디터 컨텍스트, 대화 이력), 따라야 할 지침 등을 Gemini 모델에게 전달하는 역할을 합니다.
- **더 알아보기:**
  - [Introduction to prompt design (Google AI for Developers)](https://ai.google.dev/docs/prompt_intro)
  - [Prompt engineering (OpenAI)](https://platform.openai.com/docs/guides/prompt-engineering)

### 7. Reranking (검색 결과 순위 재조정)

- **설명:** 1차적으로 검색된 결과 목록(예: 벡터 검색 결과)에 대해, 추가적인 기준이나 모델을 사용하여 사용자의 실제 의도와 더 잘 맞는 순서로 결과를 재정렬하는 과정입니다.
- **Pie Bot 적용:** `hnswlib-node` 기반 벡터 인덱스로 유사 후보를 찾은 뒤, 파일 경로나 내용의 키워드 포함 여부, 테스트 파일 여부 등을 반영해 휴리스틱 점수를 계산합니다. 상위 일부 결과는 Gemini 모델로 관련도를 다시 평가하여 기존 점수와 합산한 뒤 최종 순위를 결정하고 LLM에 제공됩니다.
- **더 알아보기:**
  - [Improving RAG Performance with Rerankers (Pinecone)](https://www.pinecone.io/learn/series/rag/rerankers/)

## 실행시에 오류가 난다면?

```bash
cd node_modules/.pnpm/hnswlib-node@3.0.0/node_modules/hnswlib-node
npx node-gyp rebuild
```

> 성공하면 `build/Release/addon.node`가 생성되어야 하며, 이 파일이 존재해야 extension이 정상 작동합니다.
