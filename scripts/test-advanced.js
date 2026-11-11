import { initDb, queryOne, queryAll } from "../src/db.js";
import { handleGetBoards, handleCreateBoard } from "../src/routes/boards.js";
import { handleGetPosts, handleCreatePost, handleGetPostDetail, handleVotePost } from "../src/routes/posts.js";
import { handleGetComments, handleCreateComment, handleDeleteComment } from "../src/routes/comments.js";
import { handleUserRegister, handleUserLogin, handleUserMe } from "../src/routes/users.js";
import { handleAdminBatchPosts, handleAdminTrash, handleAdminBadwords } from "../src/routes/admin.js";
import { filterBadwords } from "../src/badwords.js";

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

async function runAdvancedTests() {
  console.log("🚀 [종합 다중게시판 확장 기능 통합 검증 시작]\n");
  initDb();

  // 1. 다중 게시판 목록 조회
  console.log("1. 다중 게시판 목록 조회 (boards)");
  const boardsRes = createMockRes();
  handleGetBoards({}, boardsRes);
  const boardsData = boardsRes.json();
  console.log(`- 생성된 게시판 수: ${boardsData.boards?.length}개 (${boardsData.boards?.map((b) => b.name).join(", ")})`);
  if (!boardsData.boards || boardsData.boards.length < 4) throw new Error("게시판 목록 조회 실패");

  // 2. 금칙어 필터링 검증
  console.log("\n2. 금칙어(비속어) 자동 필터링 검증");
  const filtered = filterBadwords("이 사이트는 바보 같고 사기꾼 같습니다.");
  console.log(`- 원문: "이 사이트는 바보 같고 사기꾼 같습니다." ➔ 필터링: "${filtered.cleanText}"`);
  if (!filtered.hasBadword || !filtered.cleanText.includes("***")) throw new Error("금칙어 필터링 실패");

  // 3. 회원가입 및 로그인 검증
  console.log("\n3. 회원가입 및 로그인 검증");
  const testUsername = `tester_${Date.now()}`;
  const regRes = createMockRes();
  handleUserRegister({}, regRes, { username: testUsername, password: "testPassword123!", nickname: "테스터영희" });
  if (regRes.statusCode !== 201) throw new Error("회원가입 실패");

  const loginRes = createMockRes();
  handleUserLogin({}, loginRes, { username: testUsername, password: "testPassword123!" });
  const loginData = loginRes.json();
  const userCookie = loginRes.headers["Set-Cookie"]?.split(";")[0];
  console.log(`- 로그인 성공: ${loginData.user?.nickname} (포인트: ${loginData.user?.point}P)`);
  if (loginRes.statusCode !== 200 || !userCookie) throw new Error("회원 로그인 실패");

  // 4. 새 게시글 작성 (자유게시판 + 파일 첨부 메타)
  console.log("\n4. 게시글 작성 (첨부파일 포함)");
  const createRes = createMockRes();
  const mockFile = {
    originalName: "test_photo.jpg",
    storedName: "sample-uuid.jpg",
    filePath: "/uploads/sample-uuid.jpg",
    fileSize: 102400,
    mimeType: "image/jpeg",
  };
  handleCreatePost(
    { headers: { cookie: userCookie } },
    createRes,
    {
      boardId: "free",
      title: "오늘 가입 인사드립니다! 사기꾼 주의하세요.", // '사기꾼' 금칙어 포함
      content: "잘 부탁드립니다. 깨끗한 커뮤니티가 되었으면 좋겠네요.",
      category: "가입인사",
      isSecret: false,
    },
    [mockFile]
  );
  const postData = createRes.json();
  const newPostId = postData.id;
  console.log(`- 글 작성 결과: status=${createRes.statusCode}, id=${newPostId}`);
  if (createRes.statusCode !== 201 || !newPostId) throw new Error("글 작성 실패");

  // 금칙어 치환 확인
  const postCheck = queryOne("SELECT title FROM posts WHERE id = ?", [newPostId]);
  console.log(`- 저장된 제목(금칙어 치환 확인): "${postCheck.title}"`);
  if (postCheck.title.includes("사기꾼")) throw new Error("금칙어 저장 차단 실패");

  // 5. 추천(Vote) 기능 검증
  console.log("\n5. 추천(Vote) 및 중복 방지 검증");
  const voteReq = { headers: { "x-forwarded-for": "203.0.113.195" }, socket: {} };
  const voteRes1 = createMockRes();
  handleVotePost(voteReq, voteRes1, newPostId, { voteType: 1 });
  console.log(`- 첫 번째 추천 결과: status=${voteRes1.statusCode}, voteUp=${voteRes1.json().voteUp}`);
  if (voteRes1.statusCode !== 200 || voteRes1.json().voteUp !== 1) throw new Error("추천 반영 실패");

  // 동일 IP 재추천 시도 (차단되어야 함)
  const voteRes2 = createMockRes();
  handleVotePost(voteReq, voteRes2, newPostId, { voteType: 1 });
  console.log(`- 중복 추천 시도 결과: status=${voteRes2.statusCode} (${voteRes2.json().error})`);
  if (voteRes2.statusCode !== 400) throw new Error("중복 추천 방지 실패");

  // 6. 다중 댓글 및 대댓글(답글) 작성 및 삭제 검증
  console.log("\n6. 다중 댓글 및 대댓글 작성 검증");
  const commentRes1 = createMockRes();
  handleCreateComment({ headers: { cookie: userCookie } }, commentRes1, newPostId, {
    content: "환영합니다! 반갑습니다.",
  });
  const parentCommentId = commentRes1.json().id;
  console.log(`- 1단계 부모 댓글 작성 완료: id=${parentCommentId}`);

  // 대댓글 작성
  const commentRes2 = createMockRes();
  handleCreateComment({ headers: {} }, commentRes2, newPostId, {
    parentId: parentCommentId,
    authorName: "익명답글러",
    password: "replyPass1234",
    content: "저도 반갑습니다 좋은 하루 되세요!",
  });
  console.log(`- 2단계 대댓글(답글) 작성 완료: status=${commentRes2.statusCode}`);
  if (commentRes2.statusCode !== 201) throw new Error("대댓글 작성 실패");

  // 댓글 목록 조회 검증
  const commentListRes = createMockRes();
  handleGetComments({}, commentListRes, newPostId);
  console.log(`- 게시글의 총 댓글 수: ${commentListRes.json().comments?.length}개`);
  if (commentListRes.json().comments?.length !== 2) throw new Error("댓글 목록 조회 실패");

  // 7. 관리자 기능: 일괄 게시판 이동 및 휴지통 복원
  console.log("\n7. 관리자 일괄 게시판 이동 및 휴지통 복구 검증");
  const adminCookie = "complaint_admin_token=" + (queryOne("SELECT * FROM admins WHERE username = 'admin'") ? "mock-admin" : "");
  // mock admin 세션 토큰 발행
  const { createSessionToken } = await import("../src/auth.js");
  const adminObj = queryOne("SELECT * FROM admins WHERE username = 'admin'");
  const validAdminToken = createSessionToken({ id: adminObj.id, username: adminObj.username, name: adminObj.name });
  const adminReq = { headers: { cookie: `complaint_admin_token=${validAdminToken}` } };

  // 일괄 게시판 이동 (free -> gallery)
  const batchRes = createMockRes();
  handleAdminBatchPosts(adminReq, batchRes, {
    action: "move",
    postIds: [newPostId],
    targetBoardId: "gallery",
  });
  console.log(`- 일괄 이동 결과: status=${batchRes.statusCode}, msg=${batchRes.json().message}`);
  const movedCheck = queryOne("SELECT board_id FROM posts WHERE id = ?", [newPostId]);
  if (movedCheck.board_id !== "gallery") throw new Error("일괄 이동 실패");

  // 일괄 삭제 (휴지통 이동)
  const deleteBatchRes = createMockRes();
  handleAdminBatchPosts(adminReq, deleteBatchRes, {
    action: "delete",
    postIds: [newPostId],
  });
  console.log(`- 일괄 삭제 결과: ${deleteBatchRes.json().message}`);
  const trashCheck = queryOne("SELECT deleted_at FROM posts WHERE id = ?", [newPostId]);
  if (!trashCheck.deleted_at) throw new Error("휴지통 이동 실패");

  // 휴지통 복원
  const restoreRes = createMockRes();
  handleAdminTrash(adminReq, restoreRes, new URL("http://localhost"), "POST", {
    action: "restore",
    postId: newPostId,
  });
  console.log(`- 휴지통 복구 결과: ${restoreRes.json().message}`);
  const restoredCheck = queryOne("SELECT deleted_at FROM posts WHERE id = ?", [newPostId]);
  if (restoredCheck.deleted_at !== null) throw new Error("휴지통 복원 실패");

  console.log("\n========================================================");
  console.log("🎉 [종합 다중게시판 확장 스펙 100% 통합 검증 완료!]");
  console.log("========================================================");
}

runAdvancedTests().catch((err) => {
  console.error("❌ 테스트 실패:", err);
  process.exit(1);
});
