// 상태 변수
let currentBoardId = "voc";
let currentBoardsList = [];
let currentPage = 1;
let currentCategory = "전체";
let currentSort = "latest";
let currentViewMode = "LIST"; // LIST, GALLERY, WEBZINE
let searchQuery = "";
let searchType = "title";

let selectedPostId = null;
let currentLoadedPost = null;
let currentUser = null;

const STATUS_TEXT_MAP = {
  WAITING: { label: "접수대기", class: "status-text-WAITING" },
  PROCESSING: { label: "검토중", class: "status-text-PROCESSING" },
  COMPLETED: { label: "답변완료", class: "status-text-COMPLETED" },
  REJECTED: { label: "보류", class: "status-text-REJECTED" },
};

document.addEventListener("DOMContentLoaded", async () => {
  // 1. URL 파라미터에서 boardId 확인 (없으면 마지막으로 보던 게시판 복원)
  const urlParams = new URLSearchParams(window.location.search);
  const paramBoardId = urlParams.get("boardId");
  if (paramBoardId) {
    currentBoardId = paramBoardId;
    try {
      localStorage.setItem("last_active_board_id", paramBoardId);
    } catch {}
  } else {
    try {
      const savedBoardId = localStorage.getItem("last_active_board_id");
      if (savedBoardId) {
        currentBoardId = savedBoardId;
      }
    } catch {}
  }

  setupEventListeners();
  await checkUserAuth();
  await loadBoards();
  loadPosts();
});

function setupEventListeners() {
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") triggerSearch();
    });
  }
}

// 1. 게시판 목록 불러오기 & 상단 탭 렌더링
async function loadBoards() {
  try {
    const res = await fetch("/api/boards");
    const data = await res.json();
    currentBoardsList = data.boards || [];

    // 만약 현재 currentBoardId가 목록에 없으면 첫 번째 게시판으로
    if (!currentBoardsList.some((b) => b.id === currentBoardId) && currentBoardsList.length > 0) {
      currentBoardId = currentBoardsList[0].id;
    }

    const nav = document.getElementById("boardTabsNav");
    if (!nav) return;

    nav.innerHTML = currentBoardsList
      .map(
        (b) => `
        <a class="board-tab ${b.id === currentBoardId ? "active" : ""}" onclick="switchBoard('${b.id}')">
          ${escapeHtml(b.name)}
        </a>
      `
      )
      .join("");

    const boardObj = currentBoardsList.find((b) => b.id === currentBoardId);
    if (boardObj) {
      const mode = boardObj.board_type === "GALLERY" || boardObj.board_type === "WEBZINE" ? boardObj.board_type : "LIST";
      switchViewMode(mode, false);
    }

    updateBoardHeader();
  } catch (err) {
    console.error("게시판 목록 로드 실패:", err);
  }
}

function switchBoard(boardId) {
  currentBoardId = boardId;
  try {
    localStorage.setItem("last_active_board_id", boardId);
  } catch {}
  currentPage = 1;
  currentCategory = "전체";
  searchQuery = "";

  // 탭 active 갱신
  document.querySelectorAll("#boardTabsNav .board-tab").forEach((tab, index) => {
    if (currentBoardsList[index]?.id === boardId) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  // URL 주소창 갱신 (히스토리 유지)
  const newUrl = new URL(window.location);
  newUrl.searchParams.set("boardId", boardId);
  window.history.replaceState({}, "", newUrl);

  const boardObj = currentBoardsList.find((b) => b.id === boardId);
  if (boardObj) {
    const mode = boardObj.board_type === "GALLERY" || boardObj.board_type === "WEBZINE" ? boardObj.board_type : "LIST";
    switchViewMode(mode, false);
  }

  updateBoardHeader();
  loadPosts();
}

function updateBoardHeader() {
  const boardObj = currentBoardsList.find((b) => b.id === currentBoardId);
  if (boardObj) {
    document.getElementById("currentBoardTitle").textContent = boardObj.name;
    document.getElementById("currentBoardDesc").textContent = boardObj.description || "";
    document.getElementById("writeLinkBtn").href = `/write?boardId=${boardObj.id}`;
  }
}

// 2. 뷰 전환 토글 (LIST / GALLERY / WEBZINE)
function switchViewMode(mode, reload = true) {
  currentViewMode = mode;

  document.getElementById("btnViewList").classList.toggle("active", mode === "LIST");
  document.getElementById("btnViewGallery").classList.toggle("active", mode === "GALLERY");
  document.getElementById("btnViewWebzine").classList.toggle("active", mode === "WEBZINE");

  document.getElementById("viewListContainer").style.display = mode === "LIST" ? "block" : "none";
  document.getElementById("viewGalleryContainer").style.display = mode === "GALLERY" ? "block" : "none";
  document.getElementById("viewWebzineContainer").style.display = mode === "WEBZINE" ? "block" : "none";

  if (reload) {
    loadPosts();
  }
}

function changeSort() {
  currentSort = document.getElementById("sortSelect").value;
  currentPage = 1;
  loadPosts();
}

function triggerSearch() {
  const input = document.getElementById("searchInput");
  const typeSelect = document.getElementById("searchTypeSelect");
  if (input) searchQuery = input.value.trim();
  if (typeSelect) searchType = typeSelect.value;
  currentPage = 1;
  loadPosts();
}

// 3. 게시글 목록 불러오기 & 동적 말머리 렌더링
async function loadPosts() {
  const resultTextEl = document.getElementById("searchResultText");
  if (resultTextEl) {
    if (searchQuery) {
      resultTextEl.textContent = `'${searchQuery}'(으)로 찾은 검색 결과입니다.`;
    } else if (currentCategory !== "전체") {
      resultTextEl.textContent = `'${currentCategory}' 말머리 검색 결과입니다.`;
    } else {
      resultTextEl.textContent = "";
    }
  }

  try {
    const url = new URL("/api/posts", window.location.origin);
    url.searchParams.set("boardId", currentBoardId);
    url.searchParams.set("page", currentPage);
    url.searchParams.set("limit", currentViewMode === "GALLERY" ? 12 : 15);
    url.searchParams.set("sort", currentSort);
    if (currentCategory !== "전체") url.searchParams.set("category", currentCategory);
    if (searchQuery) {
      url.searchParams.set("search", searchQuery);
      url.searchParams.set("searchType", searchType);
    }

    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "목록 조회 실패");

    // 말머리 카테고리 탭 동적 렌더링 (게시판별 최적화)
    renderCategoryFilter(data.categories || ["전체"]);

    if (currentViewMode === "LIST") {
      renderTableView(data.posts, data.pagination);
    } else if (currentViewMode === "GALLERY") {
      renderGalleryView(data.posts);
    } else {
      renderWebzineView(data.posts);
    }

    renderClassicPagination(data.pagination);
  } catch (err) {
    console.error("게시글 목록 에러:", err);
  }
}

function renderCategoryFilter(categories) {
  const container = document.getElementById("categoryFilter");
  if (!container) return;

  container.innerHTML =
    `<span style="font-weight: bold; color: #444444;">말머리:</span> ` +
    categories
      .map(
        (cat, i) => `
      ${i > 0 ? "<span>|</span>" : ""}
      <a class="category-tab-item ${cat === currentCategory ? "active" : ""}" onclick="selectCategory('${escapeHtml(cat)}')">
        ${escapeHtml(cat)}
      </a>
    `
      )
      .join(" ");
}

function selectCategory(cat) {
  currentCategory = cat;
  currentPage = 1;
  loadPosts();
}

// 3-1. 목록형 렌더링
function renderTableView(posts, pagination) {
  const tbody = document.getElementById("postsTableBody");
  if (posts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: #888888;">등록된 게시글이 없습니다.</td></tr>`;
    return;
  }

  const totalCount = pagination.totalCount;
  const startIndex = totalCount - (pagination.page - 1) * pagination.limit;

  let html = "";
  posts.forEach((post, index) => {
    const postNumber = post.isNotice ? `<span class="badge-notice">공지</span>` : startIndex - index;
    const statusInfo = STATUS_TEXT_MAP[post.status] || { label: post.status, class: "" };
    const secretIcon = post.isSecret ? "🔒 " : "";
    const commentCount = post.commentCount > 0 ? `<span class="comment-count-badge">[${post.commentCount}]</span>` : "";
    const thumbIcon = post.thumbnailUrl ? `<span class="file-icon" title="사진 첨부됨">🖼️</span>` : "";

    html += `
      <tr class="${post.isNotice ? "notice-row" : ""}">
        <td class="td-no">${postNumber}</td>
        <td class="td-title">
          <span class="category-prefix">[${escapeHtml(post.category)}]</span>
          <a class="post-title-link" onclick="handleClickPost('${post.id}', ${post.isSecret})">
            ${secretIcon}${escapeHtml(post.title)}
          </a>
          ${commentCount}${thumbIcon}
        </td>
        <td class="td-author">${escapeHtml(post.authorName)}</td>
        <td class="td-date">${formatDate(post.createdAt)}</td>
        <td class="td-votes">${post.voteUp > 0 ? `+${post.voteUp}` : post.voteUp}</td>
        <td class="td-status"><span class="${statusInfo.class}">${statusInfo.label}</span></td>
      </tr>
    `;

    // 관리자 공식 답변 행 (VOC 신문고 전용)
    if (post.hasAnswer) {
      html += `
        <tr class="reply-row">
          <td class="td-no"></td>
          <td class="td-title">
            <span class="reply-indent-icon">↳</span>
            <span class="badge-re">RE</span>
            <span class="category-prefix">[${escapeHtml(post.category)}]</span>
            <a class="post-title-link" onclick="handleClickPost('${post.id}', ${post.isSecret})">
              ${escapeHtml(post.title)}에 대한 공식 답변
            </a>
          </td>
          <td class="td-author" style="color: #6688aa;">운영팀</td>
          <td class="td-date">${formatDate(post.createdAt)}</td>
          <td class="td-votes">-</td>
          <td class="td-status"><span class="status-text-COMPLETED">답변완료</span></td>
        </tr>
      `;
    }
  });

  tbody.innerHTML = html;
}

// 3-2. 갤러리형 렌더링 (비밀글 썸네일 보호)
function renderGalleryView(posts) {
  const container = document.getElementById("galleryGrid");
  if (posts.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #888888;">등록된 이미지가 없습니다.</div>`;
    return;
  }

  container.innerHTML = posts
    .map((post) => {
      let thumb;
      if (post.isSecret) {
        thumb = `<div style="font-size: 28px; color: #888;">🔒<div style="font-size: 10px; margin-top: 4px;">비밀글</div></div>`;
      } else if (post.thumbnailUrl) {
        thumb = `<img src="${post.thumbnailUrl}" alt="thumb">`;
      } else {
        thumb = `<div style="font-size: 28px; color: #aaaaaa;">🖼️</div>`;
      }

      return `
      <div class="gallery-card" onclick="handleClickPost('${post.id}', ${post.isSecret})">
        <div class="gallery-thumb">${thumb}</div>
        <div class="gallery-title">${post.isSecret ? "🔒 " : ""}[${escapeHtml(post.category)}] ${escapeHtml(post.title)}</div>
        <div class="gallery-meta">
          <span>${escapeHtml(post.authorName)}</span>
          <span>👍 ${post.voteUp} | 💬 ${post.commentCount}</span>
        </div>
      </div>
    `;
    })
    .join("");
}

// 3-3. 웹진형 렌더링
function renderWebzineView(posts) {
  const container = document.getElementById("webzineList");
  if (posts.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 40px; color: #888888;">등록된 게시글이 없습니다.</div>`;
    return;
  }

  container.innerHTML = posts
    .map((post) => {
      let thumb;
      if (post.isSecret) {
        thumb = `<div class="webzine-thumb"><span style="font-size: 20px; color: #888;">🔒</span></div>`;
      } else if (post.thumbnailUrl) {
        thumb = `<div class="webzine-thumb"><img src="${post.thumbnailUrl}" alt="thumb"></div>`;
      } else {
        thumb = `<div class="webzine-thumb"><span style="font-size: 20px; color: #bbb;">📄</span></div>`;
      }

      return `
      <div class="webzine-card" onclick="handleClickPost('${post.id}', ${post.isSecret})">
        ${thumb}
        <div class="webzine-info">
          <div class="webzine-title">
            ${post.isNotice ? '<span class="badge-notice">공지</span>' : ""}
            <span class="category-prefix">[${escapeHtml(post.category)}]</span>
            ${post.isSecret ? "🔒 " : ""}${escapeHtml(post.title)}
            ${post.commentCount > 0 ? `<span class="comment-count-badge">[${post.commentCount}]</span>` : ""}
          </div>
          <div class="webzine-snippet">${escapeHtml(post.snippet)}</div>
          <div class="webzine-meta">
            <span>작성자: ${escapeHtml(post.authorName)}</span>
            <span>등록일: ${formatDate(post.createdAt)}</span>
            <span>조회: ${post.viewCount}</span>
            <span>추천: ${post.voteUp}</span>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

// 4. 게시글 클릭 & 상세 보기 모달
function handleClickPost(id, isSecret) {
  selectedPostId = id;
  if (isSecret) {
    document.getElementById("secretPasswordInput").value = "";
    document.getElementById("passwordError").style.display = "none";
    document.getElementById("passwordModal").style.display = "flex";
  } else {
    fetchAndShowDetail(id);
  }
}

async function handleSecretPasswordSubmit(e) {
  e.preventDefault();
  const password = document.getElementById("secretPasswordInput").value;
  const passwordError = document.getElementById("passwordError");
  passwordError.style.display = "none";

  try {
    const res = await fetch(`/api/posts/${selectedPostId}?password=${encodeURIComponent(password)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "비밀번호가 올바르지 않습니다.");

    closeModal("passwordModal");
    showDetailModal(data.post, password);
  } catch (err) {
    passwordError.textContent = err.message;
    passwordError.style.display = "block";
  }
}

async function fetchAndShowDetail(id, password = "") {
  try {
    const url = password ? `/api/posts/${id}?password=${encodeURIComponent(password)}` : `/api/posts/${id}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "상세 정보를 불러올 수 없습니다.");

    if (data.requiresPassword) {
      selectedPostId = id;
      document.getElementById("passwordModal").style.display = "flex";
      return;
    }

    showDetailModal(data.post, password);
  } catch (err) {
    alert(err.message);
  }
}

function showDetailModal(post, password = "") {
  currentLoadedPost = { ...post, verifiedPassword: password };

  document.getElementById("detailTitle").textContent = (post.isNotice ? "[공지] " : "") + `[${post.category}] ${post.title}`;
  document.getElementById("detailAuthor").textContent = post.authorName;
  document.getElementById("detailCategory").textContent = post.category;
  document.getElementById("detailDate").textContent = formatDate(post.createdAt, true);
  document.getElementById("detailViews").textContent = post.viewCount;
  document.getElementById("detailVotes").textContent = post.voteUp;

  document.getElementById("btnVoteUpCount").textContent = post.voteUp;
  document.getElementById("btnVoteDownCount").textContent = post.voteDown;

  document.getElementById("detailContent").textContent = post.content;

  // 첨부파일 목록 렌더링
  const attachBox = document.getElementById("detailAttachmentsBox");
  const attachLinks = document.getElementById("detailAttachmentLinks");
  if (post.attachments && post.attachments.length > 0) {
    attachLinks.innerHTML = post.attachments
      .map((att) => `<a href="${att.filePath}" target="_blank" download="${escapeHtml(att.originalName)}">📥 ${escapeHtml(att.originalName)} (${Math.round(att.fileSize / 1024)}KB)</a>`)
      .join(" ");
    attachBox.style.display = "block";
  } else {
    attachBox.style.display = "none";
  }

  // 관리자 답변 (VOC 신문고 전용)
  const answerSection = document.getElementById("answerSection");
  if (post.answers && post.answers.length > 0) {
    const ans = post.answers[0];
    document.getElementById("answerAuthor").textContent = `${ans.authorName} 공식 답변`;
    document.getElementById("answerDate").textContent = formatDate(ans.createdAt, true);
    document.getElementById("answerContent").textContent = ans.content;
    answerSection.style.display = "block";
  } else {
    answerSection.style.display = "none";
  }

  // 댓글 목록 로드
  loadComments(post.id);

  document.getElementById("detailModal").style.display = "flex";
}

// 5. 추천 / 비추천 제출
async function handleVoteSubmit(voteType) {
  if (!currentLoadedPost) return;
  try {
    const res = await fetch(`/api/posts/${currentLoadedPost.id}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voteType }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "추천 처리 실패");

    document.getElementById("detailVotes").textContent = data.voteUp;
    document.getElementById("btnVoteUpCount").textContent = data.voteUp;
    document.getElementById("btnVoteDownCount").textContent = data.voteDown;
    alert(data.message);
  } catch (err) {
    alert(err.message);
  }
}

// 6. 다중 댓글 및 대댓글 관리
async function loadComments(postId) {
  const listEl = document.getElementById("commentsList");
  const countEl = document.getElementById("commentsTotalCount");

  try {
    const res = await fetch(`/api/posts/${postId}/comments`);
    const data = await res.json();
    const comments = data.comments || [];
    countEl.textContent = comments.length;

    if (comments.length === 0) {
      listEl.innerHTML = `<div style="text-align: center; color: #888888; font-size: 11px; padding: 10px;">등록된 댓글이 없습니다. 첫 댓글을 남겨보세요!</div>`;
      return;
    }

    const parents = comments.filter((c) => !c.parent_id);
    const replies = comments.filter((c) => c.parent_id);

    let html = "";
    parents.forEach((p) => {
      html += renderCommentItem(p, false);
      const childs = replies.filter((r) => r.parent_id === p.id);
      childs.forEach((ch) => {
        html += renderCommentItem(ch, true);
      });
    });

    listEl.innerHTML = html;
  } catch (err) {
    console.error("댓글 로드 실패:", err);
  }
}

function renderCommentItem(c, isReply) {
  return `
    <div class="comment-item ${isReply ? "is-reply" : ""}">
      <div class="comment-meta">
        <span class="comment-author">
          ${isReply ? "↳ " : ""}${c.is_admin_official ? '<span class="badge-re">RE</span> ' : ""}${escapeHtml(c.author_name)}
        </span>
        <span class="comment-date">${formatDate(c.created_at, true)}</span>
      </div>
      <div class="comment-body">${escapeHtml(c.content)}</div>
      <div class="comment-actions">
        ${!isReply ? `<a onclick="prepareReply('${c.id}')">답글달기</a>` : ""}
        <a onclick="deleteComment('${c.id}')" style="color: #c9302c;">삭제</a>
      </div>
    </div>
  `;
}

function prepareReply(parentId) {
  document.getElementById("commentParentId").value = parentId;
  document.getElementById("replyingToNotice").style.display = "block";
  document.getElementById("commentContentInput").focus();
}

function cancelReply() {
  document.getElementById("commentParentId").value = "";
  document.getElementById("replyingToNotice").style.display = "none";
}

async function handleCommentSubmit(e) {
  e.preventDefault();
  if (!currentLoadedPost) return;

  const content = document.getElementById("commentContentInput").value.trim();
  const parentId = document.getElementById("commentParentId").value;
  const authorName = document.getElementById("commentAuthorInput").value.trim();
  const password = document.getElementById("commentPasswordInput").value;
  const isSecret = document.getElementById("commentIsSecret").checked;

  if (!content) return;

  try {
    const res = await fetch(`/api/posts/${currentLoadedPost.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, parentId, authorName, password, isSecret }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "댓글 등록 실패");

    document.getElementById("commentContentInput").value = "";
    cancelReply();
    loadComments(currentLoadedPost.id);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteComment(commentId) {
  let password = "";
  if (!currentUser) {
    password = prompt("댓글 삭제 비밀번호를 입력해주세요:");
    if (!password) return;
  } else if (!confirm("댓글을 삭제하시겠습니까?")) {
    return;
  }

  try {
    const res = await fetch(`/api/comments/${commentId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "댓글 삭제 실패");

    loadComments(currentLoadedPost.id);
  } catch (err) {
    alert(err.message);
  }
}

// 7. 회원 로그인/가입/로그아웃
async function checkUserAuth() {
  try {
    const res = await fetch("/api/users/me");
    const data = await res.json();
    if (data.authenticated && data.user) {
      currentUser = data.user;
      document.getElementById("loggedOutMenu").style.display = "none";
      document.getElementById("loggedInMenu").style.display = "inline-flex";
      document.getElementById("userNicknameDisplay").textContent = currentUser.nickname;
      document.getElementById("userLevelDisplay").textContent = currentUser.level;
      document.getElementById("userPointDisplay").textContent = currentUser.point;

      const guestInputs = document.getElementById("commentGuestInputs");
      if (guestInputs) guestInputs.style.display = "none";
    } else {
      currentUser = null;
      document.getElementById("loggedOutMenu").style.display = "inline-flex";
      document.getElementById("loggedInMenu").style.display = "none";
      const guestInputs = document.getElementById("commentGuestInputs");
      if (guestInputs) guestInputs.style.display = "flex";
    }
  } catch {}
}

async function handleUserLoginSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById("userLoginError");
  errorEl.style.display = "none";

  const username = document.getElementById("userLoginUsername").value.trim();
  const password = document.getElementById("userLoginPassword").value;

  try {
    const res = await fetch("/api/users/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "로그인 실패");

    closeModal("loginModal");
    await checkUserAuth();
    loadPosts();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

async function handleUserRegisterSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById("regError");
  errorEl.style.display = "none";

  const username = document.getElementById("regUsername").value.trim();
  const password = document.getElementById("regPassword").value;
  const nickname = document.getElementById("regNickname").value.trim();

  try {
    const res = await fetch("/api/users/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, nickname }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "가입 실패");

    alert(data.message);
    closeModal("registerModal");
    openModal("loginModal");
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

async function handleUserLogoutSubmit() {
  await fetch("/api/users/logout", { method: "POST" });
  await checkUserAuth();
  loadPosts();
}

// 8. 게시글 수정/삭제 (회원 본인 글일 경우 비밀번호 생략 지원)
function openEditModal() {
  if (!currentLoadedPost) return;
  document.getElementById("editTitle").value = currentLoadedPost.title;
  document.getElementById("editContent").value = currentLoadedPost.content;
  document.getElementById("editCategory").value = currentLoadedPost.category;
  document.getElementById("editPasswordInput").value = currentLoadedPost.verifiedPassword || "";
  document.getElementById("editError").style.display = "none";
  document.getElementById("editModal").style.display = "flex";
}

async function handleEditSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById("editError");
  errorEl.style.display = "none";

  const password = document.getElementById("editPasswordInput").value;
  const title = document.getElementById("editTitle").value.trim();
  const content = document.getElementById("editContent").value.trim();
  const category = document.getElementById("editCategory").value;

  try {
    const res = await fetch(`/api/posts/${currentLoadedPost.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, title, content, category }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "수정 실패");

    alert("게시글이 수정되었습니다.");
    closeModal("editModal");
    closeModal("detailModal");
    loadPosts();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

function openDeleteModal() {
  if (!currentLoadedPost) return;

  // 로그인 회원 본인 글이거나 관리자면 바로 확인 팝업
  if (currentLoadedPost.isOwner || currentLoadedPost.isAdmin) {
    if (confirm("이 게시글을 삭제(휴지통 이동)하시겠습니까?")) {
      executeDeletePost("");
    }
    return;
  }

  document.getElementById("deletePasswordInput").value = currentLoadedPost.verifiedPassword || "";
  document.getElementById("deleteError").style.display = "none";
  document.getElementById("deleteModal").style.display = "flex";
}

async function handleDeleteSubmit(e) {
  e.preventDefault();
  const password = document.getElementById("deletePasswordInput").value;
  await executeDeletePost(password);
}

async function executeDeletePost(password) {
  const errorEl = document.getElementById("deleteError");
  if (errorEl) errorEl.style.display = "none";

  try {
    const res = await fetch(`/api/posts/${currentLoadedPost.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "삭제 실패");

    alert("게시글이 삭제되었습니다.");
    closeModal("deleteModal");
    closeModal("detailModal");
    loadPosts();
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    } else {
      alert(err.message);
    }
  }
}

// 9. 페이징 렌더링
function renderClassicPagination(pagination) {
  const container = document.getElementById("pagination");
  if (!container) return;

  const totalPages = pagination.totalPages;
  const current = pagination.page;

  if (totalPages <= 1) {
    container.innerHTML = `<span class="current-page">1</span>`;
    return;
  }

  let html = "";
  for (let i = 1; i <= totalPages; i++) {
    if (i > 1) html += `<span class="pipe">|</span>`;
    if (i === current) {
      html += `<span class="current-page">${i}</span>`;
    } else {
      html += `<a onclick="goToPage(${i})">${i}</a>`;
    }
  }

  if (current < totalPages) {
    html += `<a class="next-link" onclick="goToPage(${current + 1})">next ▷</a>`;
  }

  container.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  loadPosts();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "flex";
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

function formatDate(dateStr, includeTime = false) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  if (!includeTime) return `${year}-${month}-${day}`;
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, (tag) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[tag] || tag));
}
