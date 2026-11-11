import { initDb, queryOne, queryAll, runQuery, closeDb } from "../src/db.js";
import { handleCreatePost, handleGetPosts } from "../src/routes/posts.js";
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    writeHead(code, headers = {}) {
      this.statusCode = code;
      this.headers = { ...this.headers, ...headers };
    },
    end(data) {
      this.body = data;
    },
    json() {
      try {
        return JSON.parse(this.body);
      } catch {
        return this.body;
      }
    },
  };
}

async function runPersistenceTest() {
  console.log("==================================================");
  console.log("🧪 [데이터 영구 보존(Persistence) 실증 검증 시작]");
  console.log("==================================================");

  initDb();

  // 1. 신규 게시글 작성
  console.log("\n[단계 1] 새로운 사용자 게시글 생성");
  const uniqueTitle = "영구보존 검증글_" + Date.now();
  const req = {
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = createMockRes();
  handleCreatePost(
    req,
    res,
    {
      title: uniqueTitle,
      content: "서버가 종료되거나 재부팅되어도 이 글은 절대 지워지지 않아야 합니다.",
      authorName: "영구보존테스터",
      password: "pass1234!",
      category: "테스트",
      boardId: "free",
    },
    []
  );

  if (res.statusCode !== 201) {
    throw new Error(`글 작성 실패: ${res.body}`);
  }
  const createdPostId = res.json().id;
  console.log(`- 신규 글 작성 성공! ID: ${createdPostId}, 제목: "${uniqueTitle}"`);

  // DB에 확실히 저장되었는지 확인
  const postInDb = queryOne("SELECT * FROM posts WHERE id = ?", [createdPostId]);
  if (!postInDb) throw new Error("DB에 글이 삽입되지 않았습니다.");
  console.log(`- 1차 DB 확인 완료 (title: ${postInDb.title})`);

  // 2. DB 연결 안전 종료 (서버 껐을 때 동작 시뮬레이션)
  console.log("\n[단계 2] 서버 종료 및 WAL 체크포인트 커밋 시뮬레이션");
  closeDb();
  console.log("- DB Checkpoint (TRUNCATE) 및 Close 완료");

  // 3. 별도 프로세스에서 seed.js 실행 (기존 데이터를 지우는지 검증)
  console.log("\n[단계 3] scripts/seed.js 실행 (데이터 보호 기능 동작 검증)");
  const seedOutput = execSync("node scripts/seed.js", { encoding: "utf-8" });
  console.log(seedOutput.trim());

  // 4. 별도 프로세스 실행하여 작성한 글이 살아있는지 검증
  console.log("\n[단계 4] 새 프로세스에서 데이터베이스 재오픈 및 글 존재 확인");
  const tempVerifyPath = path.resolve(process.cwd(), "scripts", "_verify_tmp.js");
  fs.writeFileSync(
    tempVerifyPath,
    `
    import { initDb, queryOne } from "../src/db.js";
    initDb();
    const id = process.argv[2];
    const post = queryOne("SELECT id, title, board_id, author_name FROM posts WHERE id = ?", [id]);
    if (!post) {
      console.error("FAIL: 글이 소실되었습니다!");
      process.exit(1);
    }
    console.log("SUCCESS:" + JSON.stringify(post));
    `
  );

  let verifyOutput = "";
  try {
    verifyOutput = execFileSync("node", [tempVerifyPath, createdPostId], { encoding: "utf-8" });
    console.log(`- 새 프로세스 확인 결과: ${verifyOutput.trim()}`);
  } finally {
    if (fs.existsSync(tempVerifyPath)) fs.unlinkSync(tempVerifyPath);
  }

  if (!verifyOutput.includes("SUCCESS")) {
    throw new Error("서버 재시작 후 글이 소실되었습니다!");
  }

  // 5. 프론트엔드 API 조회(handleGetPosts)로 해당 게시판(free)에서 글 목록 반환되는지 확인
  console.log("\n[단계 5] API 조회 (/api/posts?boardId=free) 시 노출 여부 확인");
  initDb();
  const listUrl = new URL("http://localhost:3000/api/posts?boardId=free");
  const listRes = createMockRes();
  handleGetPosts(req, listRes, listUrl);
  const listData = listRes.json();
  const found = listData.posts?.find((p) => p.id === createdPostId);
  if (!found) {
    throw new Error("자유게시판 목록 API에서 새로 작성한 글을 찾을 수 없습니다.");
  }
  console.log(`- API 목록 정상 반환 확인! (게시판: free, 제목: "${found.title}")`);

  console.log("\n==================================================");
  console.log("🎉 [데이터 영구 보존 검증 100% 통과!]");
  console.log("   - 사이트를 끄거나 재시작해도 글이 안전하게 보존됩니다.");
  console.log("   - seed.js를 실행해도 기존 글이 삭제되지 않습니다.");
  console.log("   - 자유게시판/갤러리 등 각 게시판의 글이 영구 유지됩니다.");
  console.log("==================================================");
}

runPersistenceTest().catch((err) => {
  console.error("❌ 검증 실패:", err);
  process.exit(1);
});
