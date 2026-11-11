import { queryAll, queryOne, runQuery } from "../db.js";
import { parseCookies, verifySessionToken } from "../auth.js";

function requireAdmin(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.complaint_admin_token;
  const admin = verifySessionToken(token);
  if (!admin) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "관리자 인증이 필요합니다." }));
    return null;
  }
  return admin;
}

export function handleGetBoards(req, res) {
  const boards = queryAll("SELECT * FROM boards ORDER BY sort_order ASC, created_at ASC");
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ boards }));
}

export function handleCreateBoard(req, res, body) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { id, name, description, boardType, allowSecret, allowComment, allowVote, allowFile } = body;
  if (!id || !name) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "게시판 ID(slug)와 이름을 입력해주세요." }));
  }

  const existing = queryOne("SELECT * FROM boards WHERE id = ?", [id.trim()]);
  if (existing) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "이미 존재하는 게시판 ID입니다." }));
  }

  const now = new Date().toISOString();
  runQuery(
    `INSERT INTO boards (id, name, description, board_type, allow_secret, allow_comment, allow_vote, allow_file, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 99, ?)`,
    [
      id.trim(),
      name.trim(),
      description || "",
      boardType || "LIST",
      allowSecret ? 1 : 0,
      allowComment ? 1 : 0,
      allowVote ? 1 : 0,
      allowFile ? 1 : 0,
      now,
    ]
  );

  res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message: "게시판이 생성되었습니다." }));
}

export function handleUpdateBoard(req, res, id, body) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { name, description, boardType, allowSecret, allowComment, allowVote, allowFile, sortOrder } = body;

  runQuery(
    `UPDATE boards SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       board_type = COALESCE(?, board_type),
       allow_secret = COALESCE(?, allow_secret),
       allow_comment = COALESCE(?, allow_comment),
       allow_vote = COALESCE(?, allow_vote),
       allow_file = COALESCE(?, allow_file),
       sort_order = COALESCE(?, sort_order)
     WHERE id = ?`,
    [
      name,
      description,
      boardType,
      typeof allowSecret === "boolean" ? (allowSecret ? 1 : 0) : undefined,
      typeof allowComment === "boolean" ? (allowComment ? 1 : 0) : undefined,
      typeof allowVote === "boolean" ? (allowVote ? 1 : 0) : undefined,
      typeof allowFile === "boolean" ? (allowFile ? 1 : 0) : undefined,
      sortOrder,
      id,
    ]
  );

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message: "게시판 설정이 수정되었습니다." }));
}

export function handleDeleteBoard(req, res, id) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (id === "voc") {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "기본 신문고(voc) 게시판은 삭제할 수 없습니다." }));
  }

  runQuery("DELETE FROM boards WHERE id = ?", [id]);
  runQuery("DELETE FROM posts WHERE board_id = ?", [id]);

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message: "게시판과 관련 글이 삭제되었습니다." }));
}
