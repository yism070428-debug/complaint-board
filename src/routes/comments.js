import crypto from "node:crypto";
import { queryAll, queryOne, runQuery } from "../db.js";
import { hashPassword, verifyPassword, parseCookies, verifySessionToken } from "../auth.js";
import { filterBadwords } from "../badwords.js";

function getAdmin(req) {
  const cookies = parseCookies(req.headers?.cookie);
  return verifySessionToken(cookies.complaint_admin_token);
}

function getUser(req) {
  const cookies = parseCookies(req.headers?.cookie);
  return verifySessionToken(cookies.complaint_user_token);
}

export function handleGetComments(req, res, postId) {
  const admin = getAdmin(req);

  const comments = queryAll(
    `SELECT id, post_id, parent_id, user_id, author_name, content, is_secret, is_admin_official, created_at
     FROM comments
     WHERE post_id = ?
     ORDER BY created_at ASC`,
    [postId]
  );

  // 비밀 댓글 마스킹 처리 (관리자 또는 본인 외 마스킹)
  const sanitized = comments.map((c) => {
    if (c.is_secret && !admin) {
      return {
        ...c,
        content: "🔒 비밀 댓글입니다.",
      };
    }
    return c;
  });

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ comments: sanitized }));
}

export function handleCreateComment(req, res, postId, body) {
  const { parentId, authorName, password, content, isSecret } = body;

  if (!content || !content.trim()) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "댓글 내용을 입력해주세요." }));
  }

  const post = queryOne("SELECT * FROM posts WHERE id = ?", [postId]);
  if (!post) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "게시글을 찾을 수 없습니다." }));
  }

  // 금칙어 필터링
  const { cleanText } = filterBadwords(content);

  const admin = getAdmin(req);
  const user = getUser(req);

  let finalAuthor = "익명";
  let passwordHash = null;
  let userId = null;
  let isAdminOfficial = 0;

  if (admin) {
    finalAuthor = admin.name || "관리자";
    isAdminOfficial = 1;
  } else if (user) {
    finalAuthor = user.nickname || user.username;
    userId = user.id;
  } else {
    // 비회원 익명 댓글
    finalAuthor = (authorName && authorName.trim()) || "익명";
    if (!password || password.length < 4) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "비회원은 댓글 삭제를 위해 4자리 이상 비밀번호를 입력해야 합니다." }));
    }
    passwordHash = hashPassword(password);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  runQuery(
    `INSERT INTO comments (id, post_id, parent_id, user_id, author_name, password_hash, content, is_secret, is_admin_official, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      postId,
      parentId || null,
      userId,
      finalAuthor,
      passwordHash,
      cleanText.trim(),
      (isSecret === true || isSecret === 1 || isSecret === "true" || isSecret === "1") ? 1 : 0,
      isAdminOfficial,
      now,
    ]
  );

  res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message: "댓글이 등록되었습니다.", id }));
}

export function handleDeleteComment(req, res, commentId, body, url) {
  const admin = getAdmin(req);
  const user = getUser(req);

  const comment = queryOne("SELECT * FROM comments WHERE id = ?", [commentId]);
  if (!comment) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "댓글을 찾을 수 없습니다." }));
  }

  // 삭제 권한 검증
  if (!admin) {
    if (comment.user_id) {
      // 회원 댓글인 경우
      if (!user || user.id !== comment.user_id) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: "본인의 댓글만 삭제할 수 있습니다." }));
      }
    } else {
      // 비회원 익명 댓글인 경우 비밀번호 검증 (body 또는 쿼리 스트링)
      const password = body?.password || (url ? url.searchParams.get("password") : "");
      if (!password || !verifyPassword(password, comment.password_hash)) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ error: "비밀번호가 일치하지 않습니다." }));
      }
    }
  }

  runQuery("DELETE FROM comments WHERE id = ? OR parent_id = ?", [commentId, commentId]);

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message: "댓글이 삭제되었습니다." }));
}
