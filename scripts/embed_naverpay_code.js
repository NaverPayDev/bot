require('dotenv').config() // .env 파일 로드 (가장 먼저 실행)

const path = require('node:path')

const {GoogleGenerativeAI} = require('@google/generative-ai')
const fs = require('fs-extra')
const {globSync} = require('glob')
const ts = require('typescript')

// ================== 설정 (❗️❗️❗️ 반드시 수정하세요 ❗️❗️❗️) ==================
/**
 * 처리할 Naver Pay Dev 저장소 목록입니다.
 * 각 항목은 { name: "저장소 식별 이름", path: "로컬 클론 경로" } 형태여야 합니다.
 * 여기에 본인이 git clone한 저장소들의 실제 경로를 정확하게 입력해주세요.
 */
const NAVERPAY_REPOS = [
    {name: '@naverpay/hidash', path: '/Users/USER/pie/hidash'},
    {name: '@naverpay/cli', path: '/Users/USER/pie/naver-cli'},
    {name: '@naverpay/pite', path: '/Users/USER/pie/pite'},
    {name: '@naverpay/nurl', path: '/Users/USER/pie/nurl'},
    {name: '@naverpay/npie', path: '/Users/USER/pie/naver-pie'},
    {name: '@naverpay/code-style', path: '/Users/USER/pie/code-style'},
    {
        name: '@naverpay/browserlist-config',
        path: '/Users/USER/pie/browserslist-config',
    },
]
// =========================================================================

// --- 기타 설정 ---
const OUTPUT_FILE = path.join(__dirname, '../data/naverpay_embeddings.json') // 결과 JSON 파일 저장 경로
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const EMBEDDING_MODEL_NAME = 'embedding-001' // Gemini 임베딩 모델
const RELEVANT_EXTENSIONS = new Set([
    // 처리 대상 파일 확장자
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.java',
    '.md',
    '.html',
    '.css',
    '.scss',
])
const MAX_FILE_SIZE_BYTES = 500 * 1024 // 파일 크기 제한 (예: 500KB)
const BATCH_SIZE = 40 // 한 번에 API로 보낼 텍스트 청크 수 (API 제한 고려)
const API_DELAY_MS = 1100 // 각 API 배치 호출 사이의 지연 시간 (ms) - 속도 제한 방지용
const IGNORE_PATTERNS = [
    // 모든 저장소에서 공통으로 제외할 패턴
    '**/node_modules/**',
    '**/.git/**',
    '**/*.log',
    '**/*.lock',
    '**/*.png',
    '**/*.jpg',
    '**/*.jpeg',
    '**/*.gif',
    '**/*.svg',
    '**/*.test.ts',
    '**/*.test.js',
    '**/test/**',
    '**/tests/**',
    '**/__tests__/**',
    '**/coverage/**',
    '**/*.min.js',
    '**/*.min.css',
    '**/*.map',
    // dist 는 학습하는게 좋지 않을까?
    // "**/dist/**",
    '**/build/**',
]

if (!GEMINI_API_KEY) {
    console.error(
        '❌ [Embedder] 오류: GEMINI_API_KEY가 .env 파일에 설정되지 않았습니다. 프로젝트 루트에 .env 파일을 만들고 키를 입력해주세요.',
    )
    process.exit(1)
}
if (
    !NAVERPAY_REPOS ||
    NAVERPAY_REPOS.length === 0 ||
    !NAVERPAY_REPOS[0].path ||
    !NAVERPAY_REPOS[0].path.startsWith('/')
) {
    console.error(
        '❌ [Embedder] 오류: NAVERPAY_REPOS 배열을 올바르게 설정해주세요. 각 항목에 name과 유효한 로컬 클론 경로(path)를 입력해야 합니다.',
    )
    process.exit(1)
}
for (const repo of NAVERPAY_REPOS) {
    if (!fs.existsSync(repo.path)) {
        console.error(`❌ [Embedder] 오류: 저장소 경로를 찾을 수 없습니다: ${repo.path} (저장소 이름: ${repo.name})`)
        process.exit(1)
    }
}

// --- Gemini 클라이언트 초기화 ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const model = genAI.getGenerativeModel({model: EMBEDDING_MODEL_NAME})

/**
 * 텍스트 배열을 배치 단위로 임베딩합니다.
 * API 오류 발생 시 해당 배치의 임베딩은 건너뜁니다 (null 반환).
 * @param {string[]} texts - 임베딩할 텍스트 배열.
 * @returns {Promise<(number[] | null)[]>} - 임베딩 벡터 배열 (실패 시 null).
 */
async function embedTextsBatch(texts) {
    try {
        const result = await model.batchEmbedContents({
            requests: texts.map((text) => ({
                model: `models/${EMBEDDING_MODEL_NAME}`, // 모델 경로 명시
                content: {parts: [{text}], role: 'user'},
            })),
        })
        // Gemini SDK 응답 구조에 따라 embeddings 추출
        return result.embeddings.map((e) => e.values)
    } catch (error) {
        console.error('   [Embedder]   ⚠️ 임베딩 API 호출 중 배치 오류 발생:', error) // 상세 오류 로깅
        return Array.from({length: texts.length}).fill(null) // API 오류 시 해당 배치의 임베딩은 null로 처리하여 건너뜀
    }
}

/**
 * 주어진 JS/TS 코드에서 상위 레벨 함수 및 클래스 선언을 추출하여
 * 각각의 코드 조각과 심볼 이름을 반환합니다. 추출된 심볼이 없으면
 * 파일 전체 내용을 하나의 청크로 취급합니다.
 * @param {string} content 원본 파일 내용
 * @param {string} ext 파일 확장자 ('.js', '.ts' 등)
 * @returns {{code: string, symbol: string|null}[]} 추출된 청크 배열
 */
function chunkJsTsFile(content, extension) {
    const scriptKind = extension.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const source = ts.createSourceFile('temp' + extension, content, ts.ScriptTarget.Latest, true, scriptKind)
    const chunks = []

    function addNode(node, name) {
        const code = node.getText(source)
        if (code.trim().length > 0) {
            chunks.push({code, symbol: name})
        }
    }

    for (const stmt of source.statements) {
        if (ts.isFunctionDeclaration(stmt) && stmt.body) {
            addNode(stmt, stmt.name ? stmt.name.getText(source) : 'anonymous')
        } else if (ts.isClassDeclaration(stmt) && stmt.name) {
            addNode(stmt, stmt.name.getText(source))
        } else if (ts.isVariableStatement(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
                if (
                    decl.initializer &&
                    (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
                ) {
                    addNode(stmt, decl.name.getText(source))
                }
            }
        }
    }

    if (chunks.length === 0) {
        chunks.push({code: content, symbol: null})
    }

    return chunks
}

/**
 * 파일 확장자에 맞추어 코드 청크를 추출합니다.
 * JS/TS 계열은 함수/클래스 단위로 분할하고 그 외는 파일 전체를 사용합니다.
 * @param {string} content 파일 내용
 * @param {string} ext 확장자
 */
function extractChunks(content, extension) {
    if (['.js', '.jsx', '.ts', '.tsx'].includes(extension)) {
        return chunkJsTsFile(content, extension)
    }
    return [{code: content, symbol: null}]
}

/**
 *코드베이스를 읽고, 임베딩을 생성하여 JSON 파일로 저장합니다.
 */
async function processCodebase() {
    console.log('🚀 [Embedder] Naver Pay Dev 코드 임베딩을 시작합니다...')
    const startTime = Date.now()

    const allCodeChunks = []

    console.log('\n📂 [Embedder] 1. 지정된 저장소에서 파일 검색 및 필터링 중...')
    for (const repo of NAVERPAY_REPOS) {
        console.log(`   [Embedder]   - [${repo.name}] 저장소 처리 시작 (${repo.path})`)
        // globSync를 사용하여 동기적으로 파일 목록 가져오기
        const files = globSync(`${repo.path}/**/*`, {
            nodir: true, // 디렉토리는 결과에서 제외
            ignore: IGNORE_PATTERNS.map((p) => path.join(repo.path, p)), // 각 저장소 경로 기준으로 제외 패턴 적용
            dot: false, // '.'으로 시작하는 파일/폴더 제외 (예: .git, .vscode 등)
            absolute: true, // 파일 경로를 절대 경로로 반환
        })

        console.log(`   [Embedder]     - 총 ${files.length}개의 파일/폴더 찾음. 필터링 및 내용 읽기 진행...`)

        let repoChunkCount = 0
        for (const file of files) {
            const extension = path.extname(file).toLowerCase()
            if (RELEVANT_EXTENSIONS.has(extension)) {
                // 관련 확장자인지 확인
                try {
                    const stats = await fs.stat(file)
                    // 파일 크기 제한 및 내용이 있는 파일만 처리
                    if (stats.size > 0 && stats.size < MAX_FILE_SIZE_BYTES) {
                        const content = await fs.readFile(file, 'utf8')
                        if (content.trim().length > 0) {
                            const relativePath = path.relative(repo.path, file)
                            const chunks = extractChunks(content, extension)
                            for (const chunk of chunks) {
                                allCodeChunks.push({
                                    repository: repo.name,
                                    filePath: relativePath,
                                    symbol: chunk.symbol || undefined,
                                    content: chunk.code,
                                })
                                repoChunkCount++
                            }
                        }
                    }
                } catch (error) {
                    // 개별 파일 처리 오류는 경고로 로깅하고 계속 진행
                    console.warn(
                        `   [Embedder]     ⚠️ 파일 처리 오류 (${path.relative(repo.path, file)}): ${error.message}`,
                    )
                }
            }
        }
        console.log(`   [Embedder]   - [${repo.name}] 저장소에서 ${repoChunkCount}개의 유효한 코드 청크 수집 완료.`)
    }

    if (allCodeChunks.length === 0) {
        console.error(
            '❌ [Embedder] 처리할 코드 청크가 하나도 없습니다. NAVERPAY_REPOS 경로, RELEVANT_EXTENSIONS 또는 IGNORE_PATTERNS 설정을 확인하세요.',
        )
        return
    }

    console.log(
        `\n✨ [Embedder] 2. 총 ${allCodeChunks.length}개의 코드 청크에 대한 임베딩 생성 시작 (배치 크기: ${BATCH_SIZE}, API 호출 간 지연: ${API_DELAY_MS}ms)`,
    )

    const embeddingsData = []
    for (let index = 0; index < allCodeChunks.length; index += BATCH_SIZE) {
        const batch = allCodeChunks.slice(index, index + BATCH_SIZE)
        // 임베딩할 텍스트는 파일 경로와 내용을 포함하여 컨텍스트를 강화
        const textsToEmbed = batch.map((chunk) => {
            const symbolLine = chunk.symbol ? `Symbol: ${chunk.symbol}\n` : ''
            return (
                `Repository: ${chunk.repository}\nFile Path: ${chunk.filePath}\n` +
                symbolLine +
                `\nCode Content:\n${chunk.content.slice(0, 18_000)}`
            )
        })

        const currentBatchNumber = Math.floor(index / BATCH_SIZE) + 1
        const totalBatches = Math.ceil(allCodeChunks.length / BATCH_SIZE)
        console.log(
            `   [Embedder]   - 배치 ${currentBatchNumber} / ${totalBatches} 처리 중... (${batch.length}개 청크)`,
        )

        const vectors = await embedTextsBatch(textsToEmbed)

        for (const [i, vector] of vectors.entries()) {
            if (vector) {
                // 임베딩 성공 시에만 데이터 추가
                embeddingsData.push({
                    repository: batch[i].repository,
                    filePath: batch[i].filePath,
                    symbol: batch[i].symbol,
                    content: batch[i].content, // 원본 내용도 저장
                    vector,
                })
            } else {
                // 배치 내 개별 임베딩 실패는 경고로 로깅
                console.warn(
                    `   [Embedder]     ⚠️ [${batch[i].repository}] ${batch[i].filePath} 임베딩 실패 (배치 ${currentBatchNumber}).`,
                )
            }
        }

        console.log(`   [Embedder]   - 현재까지 성공적으로 임베딩된 수: ${embeddingsData.length}`)

        // 마지막 배치가 아니면 API 속도 제한 준수를 위해 대기
        if (currentBatchNumber < totalBatches) {
            await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS))
        }
    }

    const durationMs = Date.now() - startTime
    const durationSec = (durationMs / 1000).toFixed(2)
    console.log(
        `\n💾 [Embedder] 3. 총 ${embeddingsData.length}개의 임베딩을 '${OUTPUT_FILE}' 파일에 저장합니다... (소요 시간: ${durationSec}초)`,
    )

    try {
        await fs.ensureDir(path.dirname(OUTPUT_FILE)) // data 폴더가 없으면 생성
        await fs.writeJson(OUTPUT_FILE, embeddingsData, {spaces: 2}) // JSON 파일 저장 (가독성을 위해 spaces: 2 추가)
        console.log(`✅ [Embedder] 완료! 임베딩 데이터가 성공적으로 '${OUTPUT_FILE}'에 저장되었습니다.`)
    } catch (error) {
        console.error('❌ [Embedder] 파일 저장 중 오류가 발생했습니다:', error)
    }
}

// --- 스크립트 실행 ---
processCodebase().catch((error) => {
    console.error('❌ [Embedder] 스크립트 실행 중 예측하지 못한 오류가 발생했습니다:', error)
})
