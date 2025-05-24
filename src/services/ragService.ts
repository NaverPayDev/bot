import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

const EMBEDDINGS_FILE_PATH = "data/naverpay_embeddings.json";
const INITIAL_SEARCH_K = 15;
const FINAL_TOP_K = 3;

interface EmbeddingData {
  repository: string;
  filePath: string;
  content: string;
  vector: number[];
}

let loadedEmbeddings: EmbeddingData[] = [];

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * 사용자 질문에서 주요 키워드를 추출합니다.
 * 이 함수는 RAG(검색 증강 생성)의 Reranking 단계에서 사용됩니다.
 * 1. 목적:
 * - 순수 벡터 검색(의미론적 유사도)만으로는 사용자가 명시적으로 사용한 특정 용어나 키워드의 중요도가 낮게 평가될 수 있는 경우를 보완합니다.
 * - 추출된 키워드가 포함된 검색 결과에 가산점을 부여하여, 의미론적 유사성과
 * 키워드 일치성을 모두 고려한 최종 순위를 결정합니다.
 * 2. 작동 방식:
 * - 입력된 질문 문자열을 소문자로 변환합니다.
 * - 정규식을 사용하여 특수문자를 공백으로 치환합니다.
 * - 공백을 기준으로 문자열을 단어 배열로 분리합니다.
 * - 한글 조사나 일반적인 불용어(stop words) 및 짧은 단어를 제거하여 핵심적인 키워드만 남깁니다.
 * 3. 필요성:
 * - 사용자의 의도와 더 정확하게 일치하는 검색 결과를 제공합니다.
 * - 특정 용어에 대한 검색 정확도를 높여, 보다 정교한 정보 검색을 가능하게 합니다.
 * - 의미론적 검색과 키워드 검색의 장점을 결합하는 하이브리드 검색 방식을 지원합니다.
 *
 * @param query 사용자 질문 문자열
 * @returns 추출된 키워드 문자열 배열
 */
function extractKeywords(query: string): string[] {
  const stopWords = [
    "을",
    "를",
    "이",
    "가",
    "은",
    "는",
    "의",
    "에",
    "좀",
    "줘",
    "로",
    "바꿔줘",
    "알려줘",
    "사용법",
    "말고",
    "대신",
    "관련된",
    "대한",
    "대해",
  ];
  return query
    .toLowerCase()
    .replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !stopWords.includes(word));
}

export function loadEmbeddingsData(context: vscode.ExtensionContext): void {
  const filePath = path.join(context.extensionPath, EMBEDDINGS_FILE_PATH);
  console.log(`[Pie Bot] 임베딩 파일 로딩 시도: ${filePath}`);
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, "utf-8");
      loadedEmbeddings = JSON.parse(fileContent); // 모듈 스코프 변수에 할당
      vscode.window.showInformationMessage(
        `[Pie Bot] ${loadedEmbeddings.length}개의 코드 임베딩을 로드했습니다.`
      );
    } else {
      vscode.window.showErrorMessage(
        `[Pie Bot] 임베딩 파일을 찾을 수 없습니다! (${filePath})`
      );
      loadedEmbeddings = [];
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `[Pie Bot] 임베딩 파일 로딩 중 오류 발생: ${error.message}`
    );
    loadedEmbeddings = [];
  }
}

export function getLoadedEmbeddingsCount(): number {
  return loadedEmbeddings.length;
}

export function searchAndRerank(
  queryVector: number[],
  userQuery: string
): EmbeddingData[] {
  if (loadedEmbeddings.length === 0 || !queryVector) {
    return [];
  }

  const initialResults = loadedEmbeddings.map((data) => ({
    ...data,
    similarity: cosineSimilarity(queryVector, data.vector),
  }));
  initialResults.sort((a, b) => b.similarity - a.similarity);

  const candidates = initialResults.slice(0, INITIAL_SEARCH_K);
  const keywords = extractKeywords(userQuery);

  const rerankedResults = candidates.map((candidate) => {
    let rerankScore = candidate.similarity;
    const lowerFilePath = candidate.filePath.toLowerCase();
    const lowerContent = candidate.content.toLowerCase();
    keywords.forEach((keyword) => {
      if (lowerFilePath.includes(keyword)) {
        rerankScore += 0.15;
      }
      if (lowerContent.includes(keyword)) {
        rerankScore += 0.05;
      }
    });
    if (
      /[._-](test|spec|mock)\.[jt]sx?$/i.test(lowerFilePath) ||
      /(\/__tests__\/|\/test[s]?\/)/i.test(lowerFilePath)
    ) {
      rerankScore -= 0.4;
    }
    if (/\/src\//i.test(lowerFilePath) && !lowerFilePath.includes("index")) {
      rerankScore -= 0.05;
    }
    if (/\/?index\.[jt]sx?$/i.test(lowerFilePath)) {
      rerankScore += 0.2;
    }
    return { ...candidate, rerankScore };
  });

  rerankedResults.sort((a, b) => b.rerankScore - a.rerankScore);
  console.log(
    "[Pie Bot] Rerank 결과 (Top 5):",
    rerankedResults.slice(0, 5).map((r) => ({
      repo: r.repository,
      path: r.filePath,
      score: r.rerankScore.toFixed(4),
    }))
  );
  return rerankedResults.slice(0, FINAL_TOP_K);
}
