import crypto from "node:crypto";
import { queryOne, runQuery } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  parseCookies,
} from "../auth.js";

const USER_COOKIE_NAME = "complaint_user_token";

export function getCurrentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[USER_COOKIE_NAME];
  return verifySessionToken(token);
}

export function handleUserRegister(req, res, body) {
  const { username, password, nickname } = body;
  if (!username || !password || !nickname) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "아이디, 비밀번호, 닉네임을 모두 입력해주세요." }));
  }

  const existing = queryOne("SELECT * FROM users WHERE username = ?", [username.trim()]);
  if (existing) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "이미 존재하는 아이디입니다." }));
  }

  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);
  const now = new Date().toISOString();

  runQuery(
    `INSERT INTO users (id, username, password_hash, nickname, level, point, created_at)
     VALUES (?, ?, ?, ?, 1, 100, ?)`,
    [id, username.trim(), passwordHash, nickname.trim(), now]
  );

  res.writeHead(201, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ message: "회원가입이 완료되었습니다. (가입 축하 100포인트 지급!)" }));
}

export function handleUserLogin(req, res, body) {
  const { username, password } = body;
  if (!username || !password) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "아이디와 비밀번호를 입력해주세요." }));
  }

  const user = queryOne("SELECT * FROM users WHERE username = ?", [username.trim()]);
  if (!user) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "존재하지 않는 아이디입니다." }));
  }

  const isMatch = verifyPassword(password, user.password_hash);
  if (!isMatch) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "비밀번호가 일치하지 않습니다." }));
  }

  const token = createSessionToken({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    level: user.level,
  });

  const cookieHeader = `${USER_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": cookieHeader,
  });
  res.end(
    JSON.stringify({
      message: "로그인되었습니다.",
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        level: user.level,
        point: user.point,
      },
    })
  );
}

export function handleUserLogout(req, res) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": `${USER_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`,
  });
  res.end(JSON.stringify({ message: "로그아웃되었습니다." }));
}

export function handleUserMe(req, res) {
  const userPayload = getCurrentUser(req);
  if (!userPayload) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ authenticated: false }));
  }

  const user = queryOne("SELECT id, username, nickname, level, point FROM users WHERE id = ?", [userPayload.id]);
  if (!user) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ authenticated: false }));
  }

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ authenticated: true, user }));
}
