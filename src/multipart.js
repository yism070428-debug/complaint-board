import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * multipart/form-data 및 일반 application/json을 함께 지원하는 요청 바디 파서
 */
export function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";

    // 1. 일반 JSON 처리
    if (contentType.includes("application/json")) {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        if (!data) return resolve({ fields: {}, files: [] });
        try {
          resolve({ fields: JSON.parse(data), files: [] });
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
      return;
    }

    // 2. multipart/form-data 처리
    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (!boundaryMatch) {
        return reject(new Error("No multipart boundary found"));
      }
      const boundary = boundaryMatch[1] || boundaryMatch[2];

      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const buffer = Buffer.concat(chunks);
          const parsed = parseMultipart(buffer, boundary);
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
      return;
    }

    // 3. application/x-www-form-urlencoded 등
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      const params = new URLSearchParams(data);
      const fields = {};
      for (const [k, v] of params.entries()) {
        fields[k] = v;
      }
      resolve({ fields, files: [] });
    });
    req.on("error", reject);
  });
}

function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = [];

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let start = 0;

  while (start < buffer.length) {
    const index = buffer.indexOf(boundaryBuffer, start);
    if (index === -1) break;

    const nextIndex = buffer.indexOf(boundaryBuffer, index + boundaryBuffer.length);
    if (nextIndex === -1) break;

    // 파트 데이터 분리
    const partBuffer = buffer.subarray(index + boundaryBuffer.length + 2, nextIndex - 2);
    start = nextIndex;

    const headerEndIndex = partBuffer.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEndIndex === -1) continue;

    const headerStr = partBuffer.subarray(0, headerEndIndex).toString("utf8");
    const bodyBuffer = partBuffer.subarray(headerEndIndex + 4);

    const dispositionMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
    if (!dispositionMatch) continue;

    const fieldName = dispositionMatch[1];
    const originalFilename = dispositionMatch[2];

    if (originalFilename) {
      // 파일 파트
      if (bodyBuffer.length > 0) {
        const mimeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
        const mimeType = mimeMatch ? mimeMatch[1].trim() : "application/octet-stream";

        const ext = path.extname(originalFilename).toLowerCase();
        const storedName = `${crypto.randomUUID()}${ext}`;
        const filePath = path.join(UPLOADS_DIR, storedName);

        fs.writeFileSync(filePath, bodyBuffer);

        files.push({
          fieldName,
          originalName: originalFilename,
          storedName,
          filePath: `/uploads/${storedName}`,
          fileSize: bodyBuffer.length,
          mimeType,
        });
      }
    } else {
      // 일반 폼 필드
      fields[fieldName] = bodyBuffer.toString("utf8");
    }
  }

  return { fields, files };
}
