import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { hashPassword } from "./auth.js";

// 실행 경로(cwd)와 무관하게 항상 프로젝트 루트 기준 절대 경로로 고정 (데이터 유실 방지)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, "..");
export const dataDir = path.join(rootDir, "data");
export const uploadsDir = path.join(rootDir, "uploads");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export const dbPath = path.join(dataDir, "board.sqlite");
export const db = new DatabaseSync(dbPath);

// SQLite 안정성 및 영구 보존(Persistence) 설정
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA busy_timeout = 5000;");

// 컬럼 존재 여부 확인 헬퍼
function columnExists(tableName, columnName) {
  try {
    const pragma = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return pragma.some((col) => col.name === columnName);
  } catch {
    return false;
  }
}

export function openDb() {
  try {
    db.open();
  } catch {}
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
  } catch {}
  isClosing = false;
}

// 테이블 및 마이그레이션 초기화
export function initDb() {
  openDb();
  // 시작 시 이전 세션의 WAL 로그를 메인 DB 파일에 안전하게 병합
  try {
    db.exec("PRAGMA wal_checkpoint(FULL);");
  } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      board_type TEXT NOT NULL DEFAULT 'LIST',
      allow_secret INTEGER NOT NULL DEFAULT 1,
      allow_comment INTEGER NOT NULL DEFAULT 1,
      allow_vote INTEGER NOT NULL DEFAULT 1,
      allow_file INTEGER NOT NULL DEFAULT 1,
      read_level INTEGER NOT NULL DEFAULT 0,
      write_level INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      point INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL DEFAULT 'voc',
      user_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '익명',
      password_hash TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '일반',
      is_secret INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'WAITING',
      view_count INTEGER NOT NULL DEFAULT 0,
      vote_up INTEGER NOT NULL DEFAULT 0,
      vote_down INTEGER NOT NULL DEFAULT 0,
      is_notice INTEGER NOT NULL DEFAULT 0,
      client_ip_hash TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '총괄운영팀',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      admin_id TEXT,
      author_name TEXT NOT NULL DEFAULT '운영팀',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      parent_id TEXT,
      user_id TEXT,
      author_name TEXT NOT NULL,
      password_hash TEXT,
      content TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 0,
      is_admin_official INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      vote_type INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(post_id, ip_hash),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS badwords (
      id TEXT PRIMARY KEY,
      word TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // 마이그레이션: 누락 컬럼 추가
  if (!columnExists("posts", "board_id")) {
    db.exec("ALTER TABLE posts ADD COLUMN board_id TEXT NOT NULL DEFAULT 'voc';");
  }
  if (!columnExists("posts", "is_notice")) {
    db.exec("ALTER TABLE posts ADD COLUMN is_notice INTEGER NOT NULL DEFAULT 0;");
  }
  if (!columnExists("posts", "vote_up")) {
    db.exec("ALTER TABLE posts ADD COLUMN vote_up INTEGER NOT NULL DEFAULT 0;");
  }
  if (!columnExists("posts", "vote_down")) {
    db.exec("ALTER TABLE posts ADD COLUMN vote_down INTEGER NOT NULL DEFAULT 0;");
  }
  if (!columnExists("posts", "deleted_at")) {
    db.exec("ALTER TABLE posts ADD COLUMN deleted_at TEXT;");
  }
  if (!columnExists("posts", "user_id")) {
    db.exec("ALTER TABLE posts ADD COLUMN user_id TEXT;");
  }

  // 컬럼이 안전하게 확보된 후 인덱스 생성
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posts_board_id ON posts(board_id);
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_is_notice ON posts(is_notice);
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
    CREATE INDEX IF NOT EXISTS idx_posts_deleted_at ON posts(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_post_id ON attachments(post_id);
  `);

  // 1. 기본 게시판들이 없으면 자동 삽입 (기존 데이터 절대 덮어쓰지 않음)
  const boardCount = db.prepare("SELECT COUNT(*) as cnt FROM boards").get();
  if (boardCount && boardCount.cnt === 0) {
    const now = new Date().toISOString();
    const defaultBoards = [
      { id: "voc", name: "불만/건의 신문고", desc: "이용자 불만 및 개선 건의 창구 (공식답변)", type: "LIST", order: 1 },
      { id: "free", name: "자유게시판", desc: "누구나 자유롭게 이야기를 나누는 공간", type: "LIST", order: 2 },
      { id: "gallery", name: "포토/갤러리", desc: "사진과 이미지를 공유하는 갤러리", type: "GALLERY", order: 3 },
      { id: "notice", name: "공지사항", desc: "서비스 공식 안내 및 공지사항", type: "NOTICE", order: 4 },
    ];

    for (const b of defaultBoards) {
      db.prepare(`
        INSERT INTO boards (id, name, description, board_type, allow_secret, allow_comment, allow_vote, allow_file, sort_order, created_at)
        VALUES (?, ?, ?, ?, 1, 1, 1, 1, ?, ?)
      `).run(b.id, b.name, b.desc, b.type, b.order, now);
    }
  }

  // 2. 기본 관리자 계정이 없으면 자동 생성 (admin / admin1234!)
  const adminCount = db.prepare("SELECT COUNT(*) as cnt FROM admins").get();
  let adminId;
  if (adminCount && adminCount.cnt === 0) {
    adminId = crypto.randomUUID();
    const passwordHash = hashPassword("admin1234!");
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO admins (id, username, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      adminId,
      "admin",
      passwordHash,
      "총괄운영팀",
      now
    );
  } else {
    const adminRow = db.prepare("SELECT id FROM admins WHERE username = 'admin'").get();
    adminId = adminRow?.id;
  }

  // 3. 기본 샘플 회원 계정이 없으면 자동 생성 (user1 / user1234!)
  const userCount = db.prepare("SELECT COUNT(*) as cnt FROM users").get();
  let user1Id;
  if (userCount && userCount.cnt === 0) {
    user1Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO users (id, username, password_hash, nickname, level, point, created_at)
      VALUES (?, ?, ?, ?, 1, 250, ?)
    `).run(
      user1Id,
      "user1",
      hashPassword("user1234!"),
      "모범회원철수",
      new Date().toISOString()
    );
  } else {
    const userRow = db.prepare("SELECT id FROM users WHERE username = 'user1'").get();
    user1Id = userRow?.id;
  }

  // 4. 기본 금칙어 샘플 등록 (없을 경우)
  const badwordCount = db.prepare("SELECT COUNT(*) as cnt FROM badwords").get();
  if (badwordCount && badwordCount.cnt === 0) {
    const now = new Date().toISOString();
    const defaultBadwords = ["바보", "사기꾼", "광고스팸", "비방글", "도박사이트"];
    for (const w of defaultBadwords) {
      try {
        db.prepare("INSERT INTO badwords (id, word, created_at) VALUES (?, ?, ?)").run(
          crypto.randomUUID(),
          w,
          now
        );
      } catch {}
    }
  }

  // 5. 기본 게시글이 '전혀' 없을 때만 초기 샘플 데이터 1회 자동 생성
  // (게시글이 1건이라도 존재하면 사용자가 작성한 글을 보존하기 위해 절대 추가/삭제하지 않음)
  const postCount = db.prepare("SELECT COUNT(*) as cnt FROM posts").get();
  if (postCount && postCount.cnt === 0) {
    const now = new Date();

    // A. 공지사항 (notice)
    const noticeId1 = crypto.randomUUID();
    db.prepare(
      `INSERT INTO posts (id, board_id, title, content, author_name, password_hash, category, is_secret, is_notice, status, view_count, vote_up, created_at, updated_at)
       VALUES (?, 'notice', '시스템 정기 점검 및 서버 안정화 작업 안내', '안녕하십니까 총괄운영팀입니다.\n보다 안정적인 서비스 제공을 위해 정기 점검이 진행될 예정입니다.\n점검 시간 동안 일시적인 접속 순단이 발생할 수 있습니다.', '총괄운영팀', '', '안내', 0, 1, 'COMPLETED', 150, 12, ?, ?)`
    ).run(noticeId1, new Date(now.getTime() - 86400000 * 3).toISOString(), new Date(now.getTime() - 86400000 * 3).toISOString());

    // B. VOC 신문고 (voc)
    const vocId1 = crypto.randomUUID();
    db.prepare(
      `INSERT INTO posts (id, board_id, title, content, author_name, password_hash, category, is_secret, is_notice, status, view_count, vote_up, created_at, updated_at)
       VALUES (?, 'voc', '과장사기광고 중단하고 오투액션 생산 판매 금지 요청', '광고에서는 뿌리기만 하면 얼룩이 다 지워진다고 나오는데 전혀 지워지지 않고 옷감만 상했습니다. 이에 대한 공식 입장과 환불 조치를 요구합니다.', 'runner', ?, '세탁용품>오투액션 스프레이', 0, 0, 'COMPLETED', 68, 5, ?, ?)`
    ).run(vocId1, hashPassword("1234"), new Date(now.getTime() - 86400000 * 2).toISOString(), new Date(now.getTime() - 86400000 * 2).toISOString());

    if (adminId) {
      db.prepare(
        `INSERT INTO answers (id, post_id, admin_id, author_name, content, created_at, updated_at)
         VALUES (?, ?, ?, '총괄운영팀', '고객님 안녕하십니까, 오투액션 고객만족센터입니다.\n불편을 드려 죄송합니다. 영수증 접수 시 전액 환불 및 회수 절차를 진행해 드리겠습니다.', ?, ?)`
      ).run(crypto.randomUUID(), vocId1, adminId, new Date(now.getTime() - 86400000).toISOString(), new Date(now.getTime() - 86400000).toISOString());
    }

    const comment1Id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO comments (id, post_id, user_id, author_name, content, is_secret, is_admin_official, created_at)
       VALUES (?, ?, ?, '모범회원철수', '저도 똑같은 피해를 겪었는데 고객센터에서 바로 교환받았습니다. 참고하세요!', 0, 0, ?)`
    ).run(comment1Id, vocId1, user1Id, new Date(now.getTime() - 40000000).toISOString());

    db.prepare(
      `INSERT INTO comments (id, post_id, parent_id, author_name, password_hash, content, is_secret, is_admin_official, created_at)
       VALUES (?, ?, ?, '소비자B', ?, '어느 고객센터 번호로 전화하셨나요? 정보 공유 부탁드립니다.', 0, 0, ?)`
    ).run(crypto.randomUUID(), vocId1, comment1Id, hashPassword("1234"), new Date(now.getTime() - 20000000).toISOString());

    // C. 자유게시판 (free)
    db.prepare(
      `INSERT INTO posts (id, board_id, title, content, author_name, password_hash, category, is_secret, is_notice, status, view_count, vote_up, created_at, updated_at)
       VALUES (?, 'free', '주말에 가볼 만한 나들이 코스 추천해주세요!', '가족들과 함께 가볍게 산책하고 맛있는 음식 먹을 수 있는 곳 추천 부탁드립니다.', '자유여행자', ?, '자유수다', 0, 0, 'WAITING', 24, 7, ?, ?)`
    ).run(crypto.randomUUID(), hashPassword("1234"), new Date(now.getTime() - 50000000).toISOString(), new Date(now.getTime() - 50000000).toISOString());

    // D. 갤러리 게시판 (gallery)
    db.prepare(
      `INSERT INTO posts (id, board_id, title, content, author_name, password_hash, category, is_secret, is_notice, status, view_count, vote_up, created_at, updated_at)
       VALUES (?, 'gallery', '오늘 아침 회사 옥상에서 본 일출 풍경', '날씨가 너무 맑아서 하늘이 정말 예쁘네요. 다들 좋은 하루 보내세요!', '포토그래퍼', ?, '일상포토', 0, 0, 'WAITING', 45, 15, ?, ?)`
    ).run(crypto.randomUUID(), hashPassword("1234"), new Date(now.getTime() - 10000000).toISOString(), new Date(now.getTime() - 10000000).toISOString());
  }
}

export function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

export function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

export function runQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  const result = stmt.run(...params);
  // 변경 사항이 발생할 때마다 가벼운 체크포인트를 수행하여 데이터 디스크 영구 반영 보장
  try {
    db.exec("PRAGMA wal_checkpoint(PASSIVE);");
  } catch {}
  return result;
}

// 30초마다 자동 백그라운드 체크포인트
setInterval(() => {
  try {
    db.exec("PRAGMA wal_checkpoint(PASSIVE);");
  } catch {}
}, 30000).unref();

// 프로세스 종료 시 완벽한 체크포인트 & 연결 종료
let isClosing = false;
export function closeDb() {
  if (isClosing) return;
  isClosing = true;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.close();
  } catch {}
}

process.on("SIGINT", () => {
  closeDb();
  process.exit(0);
});

process.on("SIGTERM", () => {
  closeDb();
  process.exit(0);
});

process.on("beforeExit", () => {
  closeDb();
});
