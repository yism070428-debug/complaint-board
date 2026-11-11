import crypto from "node:crypto";
import { initDb, queryOne, runQuery } from "../src/db.js";
import { hashPassword } from "../src/auth.js";

initDb();

console.log("🌱 [다중게시판 시드 스크립트]");

// 1. 관리자 계정 생성 (admin / admin1234!)
let admin = queryOne("SELECT * FROM admins WHERE username = ?", ["admin"]);
let adminId;

if (!admin) {
  adminId = crypto.randomUUID();
  const passwordHash = hashPassword("admin1234!");
  const now = new Date().toISOString();
  runQuery(
    `INSERT INTO admins (id, username, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)`,
    [adminId, "admin", passwordHash, "총괄운영팀", now]
  );
  console.log("✅ 관리자 계정 확인 완료 (admin / admin1234!)");
} else {
  adminId = admin.id;
}

// 2. 샘플 회원 계정 생성 (user1 / user1234!)
let user1 = queryOne("SELECT * FROM users WHERE username = ?", ["user1"]);
let user1Id;
if (!user1) {
  user1Id = crypto.randomUUID();
  runQuery(
    `INSERT INTO users (id, username, password_hash, nickname, level, point, created_at)
     VALUES (?, ?, ?, ?, 1, 250, ?)`,
    [user1Id, "user1", hashPassword("user1234!"), "모범회원철수", new Date().toISOString()]
  );
  console.log("✅ 샘플 회원 계정 생성 완료 (ID: user1 / PW: user1234!)");
} else {
  user1Id = user1.id;
}

// 3. 게시글 보존 확인: 기존 글이 존재하고 --force 플래그가 없으면 데이터 유실 방지를 위해 초기화 건너뜀
const postCount = queryOne("SELECT COUNT(*) as cnt FROM posts");
const isForce = process.argv.includes("--force") || process.argv.includes("-f");

if (postCount && postCount.cnt > 0 && !isForce) {
  console.log(`\n🔒 [데이터 보호 알림] 현재 데이터베이스에 ${postCount.cnt}건의 게시글이 안전하게 저장되어 있습니다.`);
  console.log("   사용자가 작성한 소중한 게시글이 삭제되지 않도록 기존 데이터를 보존합니다.");
  console.log("   (※ 초기 샘플 상태로 완전 초기화하려면 'node scripts/seed.js --force' 를 실행하세요.)\n");
  process.exit(0);
}

console.log("⚠️ 데이터를 초기화하고 기본 샘플 게시글을 생성합니다...");
runQuery("DELETE FROM comments");
runQuery("DELETE FROM answers");
runQuery("DELETE FROM attachments");
runQuery("DELETE FROM votes");
runQuery("DELETE FROM posts");

const now = new Date();

// A. 공지사항 게시판 (notice) 공지글
const noticeId1 = crypto.randomUUID();
runQuery(
  `INSERT INTO posts (id, board_id, title, content, author_name, password_hash, category, is_secret, is_notice, status, view_count, vote_up, created_at, updated_at)
   VALUES (?, 'notice', '시스템 정기 점검 및 서버 안정화 작업 안내', '안녕하십니까 총괄운영팀입니다.\n보다 안정적인 서비스 제공을 위해 정기 점검이 진행될 예정입니다.\n점검 시간 동안 일시적인 접속 순단이 발생할 수 있습니다.', '총괄운영팀', '', '안내', 0, 1, 'COMPLETED', 150, 12, ?, ?)`,
  [noticeId1, new Date(now.getTime() - 86400000 * 3).toISOString(), new Date(now.getTime() - 86400000 * 3).toISOString()]
);

// B. VOC 신문고 게시판 (voc)
const vocId1 = crypto.randomUUID();
runQuery(
  `INSERT INTO posts (id, board_id, title, content, author_name, password_hash, category, is_secret, is_notice, status, view_count, vote_up, created_at, updated_at)
   VALUES (?, 'voc', '과장사기광고 중단하고 오투액션 생산 판매 금지 요청', '광고에서는 뿌리기만 하면 얼룩이 다 지워진다고 나오는데 전혀 지워지지 않고 옷감만 상했습니다. 이에 대한 공식 입장과 환불 조치를 요구합니다.', 'runner', ?, '세탁용품>오투액션 스프레이', 0, 0, 'COMPLETED', 68, 5, ?, ?)`,
  [vocId1, hashPassword("1234"), new Date(now.getTime() - 86400000 * 2).toISOString(), new Date(now.getTime() - 86400000 * 2).toISOString()]
);

// VOC 1 공식 답변
runQuery(
  `INSERT INTO answers (id, post_id, admin_id, author_name, content, created_at, updated_at)
   VALUES (?, ?, ?, '총괄운영팀', '고객님 안녕하십니까, 오투액션 고객만족센터입니다.\n불편을 드려 죄송합니다. 영수증 접수 시 전액 환불 및 회수 절차를 진행해 드리겠습니다.', ?, ?)`,
  [crypto.randomUUID(), vocId1, adminId, new Date(now.getTime() - 86400000).toISOString(), new Date(now.getTime() - 86400000).toISOString()]
);

// VOC 1 일반 댓글 및 대댓글
const comment1Id = crypto.randomUUID();
runQuery(
  `INSERT INTO comments (id, post_id, user_id, author_name, content, is_secret, is_admin_official, created_at)
   VALUES (?, ?, ?, '모범회원철수', '저도 똑같은 피해를 겪었는데 고객센터에서 바로 교환받았습니다. 참고하세요!', 0, 0, ?)`,
  [comment1Id, vocId1, user1Id, new Date(now.getTime() - 40000000).toISOString()]
);

// 대댓글 (답글)
runQuery(
  `INSERT INTO comments (id, post_id, parent_id, author_name, password_hash, content, is_secret, is_admin_official, created_at)
   VALUES (?, ?, ?, '소비자B', ?, '어느 고객센터 번호로 전화하셨나요? 정보 공유 부탁드립니다.', 0, 0, ?)`,
  [crypto.randomUUID(), vocId1, comment1Id, hashPassword("1234"), new Date(now.getTime() - 20000000).toISOString()]
);

// C. 자유게시판 (free)
runQuery(
  `INSERT INTO posts (id, board_id, title, content, author_name, password_hash, category, is_secret, is_notice, status, view_count, vote_up, created_at, updated_at)
   VALUES (?, 'free', '주말에 가볼 만한 나들이 코스 추천해주세요!', '가족들과 함께 가볍게 산책하고 맛있는 음식 먹을 수 있는 곳 추천 부탁드립니다.', '자유여행자', ?, '자유수다', 0, 0, 'WAITING', 24, 7, ?, ?)`,
  [crypto.randomUUID(), hashPassword("1234"), new Date(now.getTime() - 50000000).toISOString(), new Date(now.getTime() - 50000000).toISOString()]
);

// D. 갤러리 게시판 (gallery)
runQuery(
  `INSERT INTO posts (id, board_id, title, content, author_name, password_hash, category, is_secret, is_notice, status, view_count, vote_up, created_at, updated_at)
   VALUES (?, 'gallery', '오늘 아침 회사 옥상에서 본 일출 풍경', '날씨가 너무 맑아서 하늘이 정말 예쁘네요. 다들 좋은 하루 보내세요!', '포토그래퍼', ?, '일상포토', 0, 0, 'WAITING', 45, 15, ?, ?)`,
  [crypto.randomUUID(), hashPassword("1234"), new Date(now.getTime() - 10000000).toISOString(), new Date(now.getTime() - 10000000).toISOString()]
);

console.log("🎉 시딩 작업이 성공적으로 완료되었습니다.");
