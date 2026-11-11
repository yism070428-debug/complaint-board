import crypto from "node:crypto";
import { queryAll, queryOne, runQuery } from "../db.js";
import { hashPassword, verifyPassword, parseCookies, verifySessionToken } from "../auth.js";
import { filterBadwords } from "../badwords.js";

function getClientIpHash(req) {
  const forwarded = req.headers ? req.headers["x-forwarded-for"] : null;
  const ip = forwarded ? forwarded.split(",")[0].trim() : req.socket?.remoteAddress || "127.0.0.1";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function checkAdminAuth(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.complaint_admin_token;
  return verifySessionToken(token);
}

function checkUserAuth(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.complaint_user_token;
  return verifySessionToken(token);
}

function parseBoolean(val) {
  if (val === true || val === 1 || val === "true" || val === "1" || val === "on") {
    return true;
  }
  return false;
}

export function handleGetPosts(req, res, url) {
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "15", 10)));
  const boardId = url.searchParams.get("boardId") || "voc";
  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search");
  const searchType = url.searchParams.get("searchType") || "title";
  const sort = url.searchParams.get("sort") || "latest"; // latest, views, votes

  const conditions = ["p.deleted_at IS NULL"];
  const params = [];

  // 특정 게시판 필터 (통합 검색이 아닌 경우)
  if (boardId && boardId !== "ALL") {
    conditions.push("p.board_id = ?");
    params.push(boardId);
  }

  if (category && category !== "전체") {
    conditions.push("p.category = ?");
    params.push(category);
  }

  if (status && status !== "ALL") {
    conditions.push("p.status = ?");
    params.push(status);
  }

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    if (searchType === "title") {
      conditions.push("p.title LIKE ?");
      params.push(q);
    } else if (searchType === "author") {
      conditions.push("p.author_name LIKE ?");
      params.push(q);
    } else {
      conditions.push("(p.title LIKE ? OR p.author_name LIKE ? OR p.content LIKE ?)");
      params.push(q, q, q);
    }
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  // 총 카운트
  const countRow = queryOne(`SELECT COUNT(*) as total FROM posts p ${whereClause}`, params);
  const totalCount = countRow ? countRow.total : 0;

  // 정렬 기준
  let orderSql = "p.is_notice DESC, p.created_at DESC";
  if (sort === "views") {
    orderSql = "p.is_notice DESC, p.view_count DESC, p.created_at DESC";
  } else if (sort === "votes") {
    orderSql = "p.is_notice DESC, (p.vote_up - p.vote_down) DESC, p.created_at DESC";
  }

  const offset = (page - 1) * limit;
  const listSql = `
    SELECT p.id, p.board_id, p.title, p.content, p.author_name, p.category, p.is_secret, p.status,
           p.view_count, p.vote_up, p.vote_down, p.is_notice, p.created_at,
           (SELECT COUNT(*) FROM answers a WHERE a.post_id = p.id) as answer_count,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count,
           (SELECT file_path FROM attachments att WHERE att.post_id = p.id AND att.mime_type LIKE 'image/%' LIMIT 1) as thumbnail_url
    FROM posts p
    ${whereClause}
    ORDER BY ${orderSql}
    LIMIT ? OFFSET ?
  `;
  const posts = queryAll(listSql, [...params, limit, offset]);

  // 현재 게시판에서 사용 중인 고유 카테고리 목록 조회
  const catRows = queryAll(
    "SELECT DISTINCT category FROM posts WHERE board_id = ? AND deleted_at IS NULL AND category IS NOT NULL AND category != ''",
    [boardId]
  );
  const boardCategories = ["전체", ...catRows.map((r) => r.category)];

  const sanitized = posts.map((post) => ({
    id: post.id,
    boardId: post.board_id,
    title: post.is_secret === 1 ? "🔒 비밀글입니다." : post.title,
    snippet: post.is_secret === 1 ? "비밀글입니다." : post.content.slice(0, 120),
    authorName: post.author_name,
    category: post.category,
    isSecret: post.is_secret === 1,
    isNotice: post.is_notice === 1,
    status: post.status,
    viewCount: post.view_count,
    voteUp: post.vote_up,
    voteDown: post.vote_down,
    createdAt: post.created_at,
    hasAnswer: post.answer_count > 0,
    commentCount: post.comment_count,
    // 비밀글이면 썸네일 이미지 비공개 (보안)
    thumbnailUrl: post.is_secret === 1 ? null : post.thumbnail_url || null,
  }));

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      posts: sanitized,
      categories: boardCategories,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    })
  );
}

export function handleCreatePost(req, res, fields, files = []) {
  const { title, content, authorName, password, category, isSecret, boardId, isNotice } = fields;

  if (!title || !title.trim()) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "제목을 입력해주세요." }));
  }

  if (!content || !content.trim()) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "내용을 입력해주세요." }));
  }

  const admin = checkAdminAuth(req);
  const user = checkUserAuth(req);

  let finalAuthor = "익명";
  let passwordHash = "";
  let userId = null;

  if (admin) {
    finalAuthor = admin.name || "관리자";
  } else if (user) {
    finalAuthor = user.nickname || user.username;
    userId = user.id;
  } else {
    // 비회원 작성
    finalAuthor = (authorName && authorName.trim()) || "익명";
    if (!password || password.length < 4) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(
        JSON.stringify({ error: "비밀번호는 4자리 이상이어야 합니다. (글 수정/삭제/비밀글 조회용)" })
      );
    }
    passwordHash = hashPassword(password);
  }

  // 금칙어 필터링 적용
  const { cleanText: cleanTitle } = filterBadwords(title);
  const { cleanText: cleanContent } = filterBadwords(content);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const clientIpHash = getClientIpHash(req);

  runQuery(
    `INSERT INTO posts (id, board_id, user_id, title, content, author_name, password_hash, category, is_secret, status, view_count, vote_up, vote_down, is_notice, client_ip_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAITING', 0, 0, 0, ?, ?, ?, ?)`,
    [
      id,
      boardId || "voc",
      userId,
      cleanTitle.trim(),
      cleanContent.trim(),
      finalAuthor,
      passwordHash,
      category || "일반",
      parseBoolean(isSecret) ? 1 : 0,
      admin && parseBoolean(isNotice) ? 1 : 0,
      clientIpHash,
      now,
      now,
    ]
  );

  // 첨부파일 저장
  if (Array.isArray(files) && files.length > 0) {
    for (const f of files) {
      runQuery(
        `INSERT INTO attachments (id, post_id, original_name, stored_name, file_path, file_size, mime_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), id, f.originalName, f.storedName, f.filePath, f.fileSize, f.mimeType, now]
      );
    }
  }

  // 회원 작성 시 포인트 10점 지급
  if (userId) {
    runQuery("UPDATE users SET point = point + 10 WHERE id = ?", [userId]);
  }

  res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      message: "게시글이 정상적으로 등록되었습니다.",
      id,
    })
  );
}

export function handleGetPostDetail(req, res, id, url) {
  const password = url.searchParams.get("password");
  const admin = checkAdminAuth(req);
  const user = checkUserAuth(req);

  const post = queryOne("SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL", [id]);
  if (!post) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "게시글을 찾을 수 없습니다." }));
  }

  // 본인 글 여부 (회원인 경우)
  const isOwner = Boolean(user && post.user_id && user.id === post.user_id);

  // 비밀글 잠금 처리
  if (post.is_secret === 1 && !admin && !isOwner) {
    if (!password) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(
        JSON.stringify({
          requiresPassword: true,
          post: {
            id: post.id,
            boardId: post.board_id,
            title: "🔒 비밀글입니다.",
            authorName: post.author_name,
            category: post.category,
            isSecret: true,
            status: post.status,
            createdAt: post.created_at,
          },
        })
      );
    }

    const isMatch = verifyPassword(password, post.password_hash);
    if (!isMatch) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(
        JSON.stringify({ error: "비밀번호가 일치하지 않습니다.", requiresPassword: true })
      );
    }
  }

  // 조회수 증가
  runQuery("UPDATE posts SET view_count = view_count + 1 WHERE id = ?", [id]);

  // 첨부파일 조회
  const attachments = queryAll(
    `SELECT id, original_name as originalName, file_path as filePath, file_size as fileSize, mime_type as mimeType
     FROM attachments WHERE post_id = ?`,
    [id]
  );

  // 관리자 공식 답변 조회
  const answers = queryAll(
    `SELECT id, author_name as authorName, content, created_at as createdAt, updated_at as updatedAt
     FROM answers WHERE post_id = ? ORDER BY created_at ASC`,
    [id]
  );

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      post: {
        id: post.id,
        boardId: post.board_id,
        title: post.title,
        content: post.content,
        authorName: post.author_name,
        category: post.category,
        isSecret: post.is_secret === 1,
        isNotice: post.is_notice === 1,
        status: post.status,
        viewCount: post.view_count + 1,
        voteUp: post.vote_up,
        voteDown: post.vote_down,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        answers,
        attachments,
        isOwner,
        isAdmin: Boolean(admin),
      },
    })
  );
}

export function handleVotePost(req, res, id, body) {
  const { voteType } = body; // 1: 추천, -1: 비추천
  if (voteType !== 1 && voteType !== -1) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "유효하지 않은 추천 유형입니다." }));
  }

  const post = queryOne("SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL", [id]);
  if (!post) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "게시글을 찾을 수 없습니다." }));
  }

  const ipHash = getClientIpHash(req);

  // 중복 투표 검사
  const existingVote = queryOne("SELECT * FROM votes WHERE post_id = ? AND ip_hash = ?", [id, ipHash]);
  if (existingVote) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "이미 추천/비추천에 참여하셨습니다." }));
  }

  const now = new Date().toISOString();
  runQuery(
    "INSERT INTO votes (id, post_id, ip_hash, vote_type, created_at) VALUES (?, ?, ?, ?, ?)",
    [crypto.randomUUID(), id, ipHash, voteType, now]
  );

  if (voteType === 1) {
    runQuery("UPDATE posts SET vote_up = vote_up + 1 WHERE id = ?", [id]);
  } else {
    runQuery("UPDATE posts SET vote_down = vote_down + 1 WHERE id = ?", [id]);
  }

  const updated = queryOne("SELECT vote_up, vote_down FROM posts WHERE id = ?", [id]);

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      message: voteType === 1 ? "추천되었습니다." : "비추천되었습니다.",
      voteUp: updated.vote_up,
      voteDown: updated.vote_down,
    })
  );
}

export function handleUpdatePost(req, res, id, fields) {
  const { password, title, content, category, isSecret } = fields;
  const admin = checkAdminAuth(req);
  const user = checkUserAuth(req);

  const post = queryOne("SELECT * FROM posts WHERE id = ?", [id]);
  if (!post) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "게시글을 찾을 수 없습니다." }));
  }

  const isOwner = Boolean(user && post.user_id && user.id === post.user_id);

  if (!admin && !isOwner) {
    if (!password) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "비밀번호를 입력해주세요." }));
    }
    const isMatch = verifyPassword(password, post.password_hash);
    if (!isMatch) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "비밀번호가 일치하지 않습니다." }));
    }
  }

  const { cleanText: cleanTitle } = title ? filterBadwords(title) : { cleanText: post.title };
  const { cleanText: cleanContent } = content ? filterBadwords(content) : { cleanText: post.content };
  const newCategory = category !== undefined ? category : post.category;
  const newIsSecret = isSecret !== undefined ? (parseBoolean(isSecret) ? 1 : 0) : post.is_secret;
  const now = new Date().toISOString();

  runQuery(
    `UPDATE posts SET title = ?, content = ?, category = ?, is_secret = ?, updated_at = ? WHERE id = ?`,
    [cleanTitle.trim(), cleanContent.trim(), newCategory, newIsSecret, now, id]
  );

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message: "게시글이 성공적으로 수정되었습니다." }));
}

export function handleDeletePost(req, res, id, body) {
  const admin = checkAdminAuth(req);
  const user = checkUserAuth(req);

  const post = queryOne("SELECT * FROM posts WHERE id = ?", [id]);
  if (!post) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "게시글을 찾을 수 없습니다." }));
  }

  const isOwner = Boolean(user && post.user_id && user.id === post.user_id);

  if (!admin && !isOwner) {
    const password = body?.password;
    if (!password) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "비밀번호를 입력해주세요." }));
    }
    const isMatch = verifyPassword(password, post.password_hash);
    if (!isMatch) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "비밀번호가 일치하지 않습니다." }));
    }
  }

  // Soft Delete (휴지통 처리)
  const now = new Date().toISOString();
  runQuery("UPDATE posts SET deleted_at = ? WHERE id = ?", [now, id]);

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message: "게시글이 삭제(휴지통 이동)되었습니다." }));
}
