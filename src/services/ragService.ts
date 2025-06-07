import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { VectorIndex } from "./vectorIndex";

const EMBEDDINGS_FILE_PATH = "data/naverpay_embeddings.json";
const INITIAL_SEARCH_K = 15;
const FINAL_TOP_K = 3;

interface EmbeddingData {
  repository: string;
  filePath: string;
  symbol?: string;
  content: string;
  vector: number[];
  norm: number;
}

let loadedEmbeddings: EmbeddingData[] = [];
let vectorIndex: VectorIndex | null = null;

function computeNorm(vec: number[]): number {
  return Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
}

function cosineSimilarity(
  vecA: number[],
  normA: number,
  vecB: number[],
  normB: number
): number {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (normA * normB);
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
      loadedEmbeddings.forEach((e) => {
        e.norm = typeof e.norm === "number" ? e.norm : computeNorm(e.vector);
      });
      const dim = loadedEmbeddings[0]?.vector.length;
      if (typeof dim === "number" && dim > 0) {
        vectorIndex = new VectorIndex(dim);
        vectorIndex.build(loadedEmbeddings.map((e) => e.vector));
      } else {
        vectorIndex = null;
      }
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

/**
 * 사용자 질문 벡터와 원본 질문 텍스트를 기반으로, 로드된 임베딩 데이터에서 가장 관련성 높은 코드 조각들을 검색하고 순위를 재조정합니다.
 * 이 함수는 두 단계의 검색 및 순위 조정을 거칩니다:
 * 1. 1단계 (초기 검색): 코사인 유사도를 사용하여 전체 임베딩 데이터에서 의미론적으로 유사한 후보군(`INITIAL_SEARCH_K` 개수만큼)을 일차적으로 선정합니다.
 * 2. 2단계 (Reranking):
 * - 사용자 질문에서 주요 키워드를 추출합니다.
 * - 1단계에서 선정된 후보군에 대해, 각 항목의 파일 경로 및 내용에 추출된 키워드가 포함되어 있는지 여부,  테스트 파일인지 여부, 'index' 파일인지 여부, 'src' 디렉토리 하위 여부 등의 휴리스틱 규칙을 적용하 초기 유사도 점수를 조정한 'rerankScore'를 계산합니다.
 * - 이 'rerankScore'를 기준으로 최종 순위를 매기고, 가장 관련성이 높다고 판단되는 상위 `FINAL_TOP_K`개의 결과를 반환합니다.
 * * 함수 실행 중, Reranking된 상위 5개 결과의 저장소, 파일 경로, 최종 점수가 콘솔에 로깅됩니다.
 * * @param queryVector 사용자의 질문을 임베딩한 숫자 벡터입니다.
 * @param userQuery 사용자의 원본 질문 텍스트 문자열입니다 (키워드 추출에 사용됨).
 * @returns Reranking 과정을 거쳐 최종적으로 선정된 상위 `FINAL_TOP_K`개의 `EmbeddingData` 객체 배열을 반환합니다. 로드된 임베딩 데이터가 없거나 질문 벡터가 유효하지 않으면 빈 배열을 반환합니다.
 */
import { scoreRelevance } from "./geminiApiService";

export async function searchAndRerank(
  queryVector: number[],
  userQuery: string,
  apiKey?: string
): Promise<EmbeddingData[]> {
  if (loadedEmbeddings.length === 0 || !queryVector) {
    return [];
  }

  // 1단계: 벡터 검색 (빠른 인덱스가 있으면 활용)
  let initialResults: (EmbeddingData & { similarity: number })[];
  if (vectorIndex) {
    const neighbors = vectorIndex.search(queryVector, INITIAL_SEARCH_K);
    initialResults = neighbors.map(({ id, distance }) => ({
      ...loadedEmbeddings[id],
      similarity: 1 - distance,
    }));
  } else {
    const queryNorm = computeNorm(queryVector);
    initialResults = loadedEmbeddings.map((data) => ({
      ...data,
      similarity: cosineSimilarity(queryVector, queryNorm, data.vector, data.norm),
    }));
    initialResults.sort((a, b) => b.similarity! - a.similarity!);
  }

  // 2단계 (Reranking)를 위한 후보군 선정
  const candidates = initialResults.slice(0, INITIAL_SEARCH_K);
  const keywords = extractKeywords(userQuery); // 질문에서 키워드 추출

  const rerankedResults = candidates.map((candidate) => {
    let rerankScore = candidate.similarity!; // 기본 점수는 코사인 유사도
    const lowerFilePath = candidate.filePath.toLowerCase();
    const lowerContent = candidate.content.toLowerCase();
    const lowerSymbol = candidate.symbol ? candidate.symbol.toLowerCase() : "";

    // 키워드 일치 여부에 따른 점수 가산
    keywords.forEach((keyword) => {
      if (lowerFilePath.includes(keyword)) {
        rerankScore += 0.15; // 파일 경로에 키워드 포함 시 가점
      }
      if (lowerContent.includes(keyword)) {
        rerankScore += 0.05; // 내용에 키워드 포함 시 가점
      }
      if (lowerSymbol.includes(keyword)) {
        rerankScore += 0.1; // 심볼명에 키워드 포함 시 가점
      }
    });

    // 특정 파일 유형 또는 경로에 따른 점수 조정 (페널티 또는 보너스)
    if (
      /[._-](test|spec|mock)\.[jt]sx?$/i.test(lowerFilePath) || // 테스트 파일 확장자 패턴
      /(\/__tests__\/|\/test[s]?\/)/i.test(lowerFilePath) // 테스트 폴더 경로 패턴
    ) {
      rerankScore -= 0.4; // 테스트 파일에 페널티
    }
    if (/\/src\//i.test(lowerFilePath) && !lowerFilePath.includes("index")) {
      rerankScore -= 0.05; // 'src' 폴더 하위 파일 (index 파일 제외)에 약간의 페널티
    }
    if (/\/?index\.[jt]sx?$/i.test(lowerFilePath)) {
      rerankScore += 0.2; // 'index' 파일에 보너스
    }
    return { ...candidate, rerankScore }; // rerankScore 속성 추가
  });

  // 최종 Rerank 점수 기준으로 정렬
  rerankedResults.sort((a, b) => b.rerankScore! - a.rerankScore!);

  // 디버깅을 위해 상위 5개 결과 로깅
  console.log(
    "[Pie Bot] Rerank 결과 (Top 5):",
    rerankedResults.slice(0, 5).map((r) => ({
      repo: r.repository,
      path: r.filePath,
      symbol: r.symbol,
      score: r.rerankScore!.toFixed(4), // 소수점 4자리까지 표시
    }))
  );

  let finalResults = rerankedResults;
  if (apiKey) {
    const topForScoring = rerankedResults.slice(0, 5);
    for (const candidate of topForScoring) {
      const score = await scoreRelevance(
        apiKey,
        userQuery,
        candidate.content.substring(0, 1000)
      );
      if (typeof score === "number") {
        candidate.rerankScore =
          candidate.rerankScore! * 0.7 + score * 0.3;
      }
    }
    topForScoring.sort((a, b) => b.rerankScore! - a.rerankScore!);
    finalResults = topForScoring;
  }

  // 최종적으로 상위 FINAL_TOP_K 개 결과 반환
  return finalResults.slice(0, FINAL_TOP_K);
}
