import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, closeDb } from "./src/db.js";
import { parseRequestBody } from "./src/multipart.js";
import {
  handleGetPosts,
  handleCreatePost,
  handleGetPostDetail,
  handleUpdatePost,
  handleDeletePost,
  handleVotePost,
} from "./src/routes/posts.js";
import {
  handleAdminLogin,
  handleAdminLogout,
  handleAdminMe,
  handleAdminGetPosts,
  handleAdminAnswer,
  handleAdminUpdateStatus,
  handleAdminBatchPosts,
  handleAdminTrash,
  handleAdminBadwords,
  handleAdminUsers,
} from "./src/routes/admin.js";
import {
  handleGetBoards,
  handleCreateBoard,
  handleUpdateBoard,
  handleDeleteBoard,
} from "./src/routes/boards.js";
import {
  handleGetComments,
  handleCreateComment,
  handleDeleteComment,
} from "./src/routes/comments.js";
import {
  handleUserRegister,
  handleUserLogin,
  handleUserLogout,
  handleUserMe,
} from "./src/routes/users.js";

// DB 초기화
initDb();

const PORT = process.env.PORT || 3000;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(rootDir, "public");
const UPLOADS_DIR = path.join(rootDir, "uploads");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".zip": "application/zip",
};

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  try {
    // 1. 업로드된 파일 정적 서빙 (/uploads/...)
    if (pathname.startsWith("/uploads/")) {
      const fileName = path.basename(pathname);
      const filePath = path.join(UPLOADS_DIR, fileName);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return serveStaticFile(res, filePath);
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("File not found");
    }

    // 2. API 라우팅
    if (pathname.startsWith("/api/")) {
      // Boards API
      if (pathname === "/api/boards") {
        if (method === "GET") return handleGetBoards(req, res);
        if (method === "POST") {
          const { fields } = await parseRequestBody(req);
          return handleCreateBoard(req, res, fields);
        }
      }

      const boardMatch = pathname.match(/^\/api\/boards\/([a-zA-Z0-9_-]+)$/);
      if (boardMatch) {
        const id = boardMatch[1];
        if (method === "PUT") {
          const { fields } = await parseRequestBody(req);
          return handleUpdateBoard(req, res, id, fields);
        }
        if (method === "DELETE") {
          return handleDeleteBoard(req, res, id);
        }
      }

      // Users API
      if (pathname === "/api/users/register" && method === "POST") {
        const { fields } = await parseRequestBody(req);
        return handleUserRegister(req, res, fields);
      }
      if (pathname === "/api/users/login" && method === "POST") {
        const { fields } = await parseRequestBody(req);
        return handleUserLogin(req, res, fields);
      }
      if (pathname === "/api/users/logout" && method === "POST") {
        return handleUserLogout(req, res);
      }
      if (pathname === "/api/users/me" && method === "GET") {
        return handleUserMe(req, res);
      }

      // Posts API
      if (pathname === "/api/posts") {
        if (method === "GET") return handleGetPosts(req, res, url);
        if (method === "POST") {
          const { fields, files } = await parseRequestBody(req);
          return handleCreatePost(req, res, fields, files);
        }
      }

      // Post Vote: /api/posts/:id/vote
      const voteMatch = pathname.match(/^\/api\/posts\/([a-zA-Z0-9_-]+)\/vote$/);
      if (voteMatch && method === "POST") {
        const id = voteMatch[1];
        const { fields } = await parseRequestBody(req);
        return handleVotePost(req, res, id, fields);
      }

      // Post Comments: /api/posts/:id/comments
      const commentsMatch = pathname.match(/^\/api\/posts\/([a-zA-Z0-9_-]+)\/comments$/);
      if (commentsMatch) {
        const id = commentsMatch[1];
        if (method === "GET") return handleGetComments(req, res, id);
        if (method === "POST") {
          const { fields } = await parseRequestBody(req);
          return handleCreateComment(req, res, id, fields);
        }
      }

      // Single Comment: /api/comments/:id
      const commentDeleteMatch = pathname.match(/^\/api\/comments\/([a-zA-Z0-9_-]+)$/);
      if (commentDeleteMatch && method === "DELETE") {
        const id = commentDeleteMatch[1];
        let fields = {};
        try {
          const parsed = await parseRequestBody(req);
          fields = parsed.fields;
        } catch {}
        return handleDeleteComment(req, res, id, fields, url);
      }

      // Single Post: /api/posts/:id
      const postMatch = pathname.match(/^\/api\/posts\/([a-zA-Z0-9_-]+)$/);
      if (postMatch) {
        const id = postMatch[1];
        if (method === "GET") return handleGetPostDetail(req, res, id, url);
        if (method === "PATCH") {
          const { fields } = await parseRequestBody(req);
          return handleUpdatePost(req, res, id, fields);
        }
        if (method === "DELETE") {
          const { fields } = await parseRequestBody(req);
          return handleDeletePost(req, res, id, fields);
        }
      }

      // Admin Auth
      if (pathname === "/api/admin/login" && method === "POST") {
        const { fields } = await parseRequestBody(req);
        return handleAdminLogin(req, res, fields);
      }
      if (pathname === "/api/admin/logout" && method === "POST") {
        return handleAdminLogout(req, res);
      }
      if (pathname === "/api/admin/me" && method === "GET") {
        return handleAdminMe(req, res);
      }

      // Admin Posts & Batch
      if (pathname === "/api/admin/posts" && method === "GET") {
        return handleAdminGetPosts(req, res, url);
      }
      if (pathname === "/api/admin/posts/batch" && method === "POST") {
        const { fields } = await parseRequestBody(req);
        return handleAdminBatchPosts(req, res, fields);
      }

      // Admin Answer & Status
      const answerMatch = pathname.match(/^\/api\/admin\/posts\/([a-zA-Z0-9_-]+)\/answer$/);
      if (answerMatch && method === "POST") {
        const id = answerMatch[1];
        const { fields } = await parseRequestBody(req);
        return handleAdminAnswer(req, res, id, fields);
      }

      const statusMatch = pathname.match(/^\/api\/admin\/posts\/([a-zA-Z0-9_-]+)\/status$/);
      if (statusMatch && method === "PATCH") {
        const id = statusMatch[1];
        const { fields } = await parseRequestBody(req);
        return handleAdminUpdateStatus(req, res, id, fields);
      }

      // Admin Trash
      if (pathname === "/api/admin/trash") {
        const fields = method === "GET" ? {} : (await parseRequestBody(req)).fields;
        return handleAdminTrash(req, res, url, method, fields);
      }

      // Admin Badwords
      if (pathname === "/api/admin/badwords") {
        const fields = method === "GET" ? {} : (await parseRequestBody(req)).fields;
        return handleAdminBadwords(req, res, method, fields);
      }

      // Admin Users
      if (pathname === "/api/admin/users") {
        const fields = method === "GET" ? {} : (await parseRequestBody(req)).fields;
        return handleAdminUsers(req, res, method, fields);
      }

      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "API 엔드포인트를 찾을 수 없습니다." }));
    }

    // 3. 정적 파일 서빙
    let filePath;
    if (pathname === "/" || pathname === "/index.html") {
      filePath = path.join(PUBLIC_DIR, "index.html");
    } else if (pathname === "/write") {
      filePath = path.join(PUBLIC_DIR, "write.html");
    } else if (pathname === "/admin") {
      filePath = path.join(PUBLIC_DIR, "admin.html");
    } else {
      filePath = path.join(PUBLIC_DIR, pathname);
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return serveStaticFile(res, filePath);
    }

    return serveStaticFile(res, path.join(PUBLIC_DIR, "index.html"));
  } catch (err) {
    console.error("Server error:", err);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "서버 내부 오류가 발생했습니다." }));
  }
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`[종합 다중게시판 시스템] 서버 가동 완료 (Zero-Dependency)`);
  console.log(`- 서비스 메인: http://localhost:${PORT}`);
  console.log(`- 관리자 센터: http://localhost:${PORT}/admin`);
  console.log(`===============================================`);
});

function handleGracefulShutdown(signal) {
  console.log(`\n[${signal}] 서버를 안전하게 종료하고 DB 데이터를 디스크에 플러시합니다...`);
  server.close(() => {
    closeDb();
    console.log("[종료 완료] 모든 데이터가 안전하게 저장되었습니다.");
    process.exit(0);
  });
  // 타임아웃 2초 후 강제 종료
  setTimeout(() => {
    closeDb();
    process.exit(0);
  }, 2000).unref();
}

process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
