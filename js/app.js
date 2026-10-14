/* ============================================================
 * InstaPost Editor
 * Pure client-side Instagram post builder:
 *  - upload images & videos into a media library
 *  - pick a video (or image) as the post background
 *  - place images on top with frame presets (polaroid, stamp, …)
 *  - manage multiple posts
 *  - export a post as PNG, a post as video, or all posts as one video
 * ============================================================ */
"use strict";

/* ---------------- constants & state ---------------- */

const ASPECTS = {
  "1:1":  [1080, 1080],
  "4:5":  [1080, 1350],
  "9:16": [1080, 1920],
};

const MAX_IMG_DIM = 2000;   // cap stored image resolution to keep memory sane
const EXPORT_FPS = 30;
const VIDEO_BPS = 10_000_000;

const state = {
  media: [],            // {id, type:'image'|'video', name, url, el, width, height, duration}
  posts: [],            // see createPost()
  activePostId: null,
  selectedOverlayId: null,
};

let uid = 0;
const nextId = () => ++uid;

/* ---------------- DOM refs ---------------- */

const $ = (sel) => document.querySelector(sel);

const canvas = $("#editor-canvas");
const ctx = canvas.getContext("2d");

const fileInput = $("#file-input");
const dropZone = $("#drop-zone");
const mediaGrid = $("#media-grid");
const postList = $("#post-list");
const aspectSelect = $("#aspect-select");

const postNameInput = $("#post-name-input");
const bgInfo = $("#bg-info");
const bgColorInput = $("#bg-color-input");
const stillDurationInput = $("#still-duration-input");

const overlayProps = $("#overlay-props");
const presetButtons = $("#preset-buttons");
const captionField = $("#caption-field");
const captionInput = $("#caption-input");
const scaleInput = $("#scale-input");
const scaleValue = $("#scale-value");
const rotationInput = $("#rotation-input");
const rotationValue = $("#rotation-value");
const shadowInput = $("#shadow-input");

const exportOverlay = $("#export-overlay");
const exportStatus = $("#export-status");

const welcomeOverlay = $("#welcome-overlay");
const helpModal = $("#help-modal");
const mobileTabs = $("#mobile-tabs");

const toastEl = $("#toast");

const isTouch = window.matchMedia("(hover: none)").matches;
const isPhoneLayout = () => window.matchMedia("(max-width: 820px)").matches;

/* ---------------- helpers ---------------- */

function toast(msg, ms = 3500) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => (toastEl.hidden = true), ms);
}

function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const getMedia = (id) => state.media.find((m) => m.id === id) || null;
const activePost = () => state.posts.find((p) => p.id === state.activePostId) || null;
const selectedOverlay = () => {
  const p = activePost();
  return p ? p.overlays.find((o) => o.id === state.selectedOverlayId) || null : null;
};

function safeName(s) {
  return (s || "post").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "post";
}

/* ---------------- media library ---------------- */

async function addFiles(fileList) {
  const files = [...fileList].filter(
    (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
  );
  if (!files.length) return;

  let autoBg = null;
  for (const file of files) {
    try {
      const item = file.type.startsWith("video/")
        ? await loadVideo(file)
        : await loadImage(file);
      state.media.push(item);
      // First video lands as the background automatically.
      if (item.type === "video" && !autoBg && activePost() && !activePost().bgId) {
        autoBg = item;
      }
    } catch (err) {
      console.error(err);
      toast(`Could not load "${file.name}"`);
    }
  }
  renderMediaGrid();
  if (autoBg) {
    setBackground(autoBg.id);
    toast(`“${autoBg.name}” set as the background — now tap a picture to place it on top`);
  } else {
    toast(`Added ${files.length} file(s) — tap a video for the background, a picture to place it`);
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Downscale very large photos once, so frame rendering stays fast.
      let el = img, w = img.naturalWidth, h = img.naturalHeight;
      const k = MAX_IMG_DIM / Math.max(w, h);
      if (k < 1) {
        const c = document.createElement("canvas");
        c.width = Math.round(w * k);
        c.height = Math.round(h * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        el = c; w = c.width; h = c.height;
      }
      resolve({ id: nextId(), type: "image", name: file.name, url, el, width: w, height: h });
    };
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = url;
  });
}

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadedmetadata = async () => {
      // Some blobs (e.g. screen/camera recordings) report Infinity until a
      // far seek forces Chrome to compute the real duration.
      if (!isFinite(v.duration)) {
        await new Promise((res) => {
          const done = () => { v.onseeked = null; res(); };
          v.onseeked = done;
          setTimeout(done, 2000);
          v.currentTime = 1e7;
        });
        v.currentTime = 0;
      }
      resolve({
        id: nextId(), type: "video", name: file.name, url, el: v,
        width: v.videoWidth, height: v.videoHeight,
        duration: isFinite(v.duration) ? v.duration : 0,
      });
    };
    v.onerror = () => reject(new Error("video decode failed"));
  });
}

function removeMedia(id) {
  const idx = state.media.findIndex((m) => m.id === id);
  if (idx === -1) return;
  const m = state.media[idx];
  // Detach from every post that uses it.
  for (const post of state.posts) {
    if (post.bgId === id) post.bgId = null;
    post.overlays = post.overlays.filter((o) => o.mediaId !== id);
  }
  if (m.type === "video") m.el.pause();
  URL.revokeObjectURL(m.url);
  state.media.splice(idx, 1);
  if (selectedOverlay() === null) state.selectedOverlayId = null;
  renderMediaGrid();
  renderPostList();
  syncPostPanel();
  syncOverlayPanel();
}

function renderMediaGrid() {
  mediaGrid.innerHTML = "";
  for (const m of state.media) {
    const card = document.createElement("div");
    card.className = "media-card";
    card.title = m.type === "video" ? "Tap to use as the background" : "Tap to place on the canvas";
    // Tapping the card does the obvious thing; the small buttons stay for
    // explicit control (e.g. using a picture as the background).
    card.onclick = () => {
      if (m.type === "video") {
        setBackground(m.id);
        toast(`“${m.name}” is now the background`);
      } else {
        addOverlay(m.id);
      }
      if (isPhoneLayout()) showTab("canvas");
    };

    let thumb;
    if (m.type === "image") {
      thumb = document.createElement("img");
      thumb.src = m.url;
    } else {
      thumb = document.createElement("video");
      thumb.src = m.url;
      thumb.muted = true;
      thumb.preload = "metadata";
      thumb.onloadedmetadata = () => { try { thumb.currentTime = 0.05; } catch {} };
    }
    card.appendChild(thumb);

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = m.type === "video" ? `▶ ${m.duration ? m.duration.toFixed(1) + "s" : "video"}` : "img";
    card.appendChild(badge);

    const actions = document.createElement("div");
    actions.className = "actions";

    const bgBtn = document.createElement("button");
    bgBtn.textContent = "BG";
    bgBtn.title = "Use as the post background";
    bgBtn.onclick = (e) => { e.stopPropagation(); setBackground(m.id); };
    actions.appendChild(bgBtn);

    if (m.type === "image") {
      const addBtn = document.createElement("button");
      addBtn.textContent = "+ Add";
      addBtn.title = "Place on top of the background";
      addBtn.onclick = (e) => { e.stopPropagation(); addOverlay(m.id); };
      actions.appendChild(addBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.className = "del";
    delBtn.textContent = "✕";
    delBtn.title = "Remove from library";
    delBtn.onclick = (e) => { e.stopPropagation(); removeMedia(m.id); };
    actions.appendChild(delBtn);

    card.appendChild(actions);
    mediaGrid.appendChild(card);
  }
}

/* ---------------- posts ---------------- */

function createPost() {
  const post = {
    id: nextId(),
    name: `Post ${state.posts.length + 1}`,
    aspect: aspectSelect.value,
    bgId: null,
    bgColor: "#15161c",
    stillDuration: 5,
    overlays: [],
  };
  state.posts.push(post);
  setActivePost(post.id);
  renderPostList();
  return post;
}

function deletePost(id) {
  if (state.posts.length === 1) {
    toast("You need at least one post");
    return;
  }
  const idx = state.posts.findIndex((p) => p.id === id);
  if (idx === -1) return;
  state.posts.splice(idx, 1);
  if (state.activePostId === id) {
    setActivePost(state.posts[Math.max(0, idx - 1)].id);
  }
  renderPostList();
}

function setActivePost(id) {
  state.activePostId = id;
  state.selectedOverlayId = null;
  const post = activePost();
  if (post) {
    aspectSelect.value = post.aspect;
    applyCanvasSize(post.aspect);
    syncBackgroundPlayback();
  }
  renderPostList();
  syncPostPanel();
  syncOverlayPanel();
}

function applyCanvasSize(aspect) {
  const [w, h] = ASPECTS[aspect] || ASPECTS["4:5"];
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/** Play only the active post's background video (muted preview); pause the rest. */
function syncBackgroundPlayback() {
  const post = activePost();
  const bg = post ? getMedia(post.bgId) : null;
  for (const m of state.media) {
    if (m.type !== "video") continue;
    if (bg && m.id === bg.id) {
      m.el.loop = true;
      m.el.muted = true;
      m.el.play().catch(() => {});
    } else {
      m.el.pause();
    }
  }
}

function setBackground(mediaId) {
  const post = activePost();
  if (!post) return;
  post.bgId = mediaId;
  syncBackgroundPlayback();
  syncPostPanel();
  renderPostList();
}

function renderPostList() {
  postList.innerHTML = "";
  for (const post of state.posts) {
    const card = document.createElement("div");
    card.className = "post-card" + (post.id === state.activePostId ? " active" : "");
    card.onclick = () => setActivePost(post.id);

    const title = document.createElement("div");
    title.className = "post-title";
    title.textContent = post.name;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "post-meta";
    const bg = getMedia(post.bgId);
    meta.textContent = `${post.aspect} · ${bg ? (bg.type === "video" ? "🎞" : "🖼") : "—"} · ${post.overlays.length} img`;
    card.appendChild(meta);

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.title = "Delete post";
    del.onclick = (e) => { e.stopPropagation(); deletePost(post.id); };
    card.appendChild(del);

    postList.appendChild(card);
  }
}

/* ---------------- overlays & frame presets ---------------- */

function addOverlay(mediaId) {
  const post = activePost();
  const media = getMedia(mediaId);
  if (!post || !media || media.type !== "image") return;

  const ov = {
    id: nextId(),
    mediaId,
    x: canvas.width / 2,
    y: canvas.height / 2,
    scale: 1,
    rotation: (Math.random() - 0.5) * 0.12,  // tiny random tilt looks hand-placed
    preset: "polaroid",
    caption: "",
    shadow: true,
    framed: null, fw: 0, fh: 0,
  };
  buildFramed(ov);
  // Start at ~45% of canvas width.
  ov.scale = (canvas.width * 0.45) / ov.fw;
  post.overlays.push(ov);
  state.selectedOverlayId = ov.id;
  syncOverlayPanel();
  renderPostList();
}

/**
 * Pre-renders the image inside its frame preset into an offscreen canvas
 * (ov.framed) at the image's natural resolution, so the main draw loop only
 * has to blit one bitmap per overlay.
 */
function buildFramed(ov) {
  const media = getMedia(ov.mediaId);
  if (!media) return;
  const iw = media.width, ih = media.height;
  const S = Math.min(iw, ih);

  const c = document.createElement("canvas");
  const g = c.getContext("2d");

  switch (ov.preset) {
    case "plain": {
      const p = Math.round(S * 0.06);
      c.width = iw + p * 2; c.height = ih + p * 2;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(media.el, p, p, iw, ih);
      break;
    }

    case "polaroid": {
      const p = Math.round(S * 0.06);
      const bottom = Math.round(S * 0.24);
      c.width = iw + p * 2; c.height = ih + p + bottom;
      g.fillStyle = "#fdfdf8";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(media.el, p, p, iw, ih);
      if (ov.caption) {
        g.fillStyle = "#3a3a3a";
        g.font = `${Math.round(bottom * 0.42)}px 'Segoe Script', 'Bradley Hand', 'Comic Sans MS', cursive`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(ov.caption, c.width / 2, ih + p + bottom / 2, c.width - p * 2);
      }
      break;
    }

    case "stamp": {
      const p = Math.round(S * 0.09);
      c.width = iw + p * 2; c.height = ih + p * 2;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      // Punch perforation holes along all four edges.
      const r = p * 0.42;
      g.globalCompositeOperation = "destination-out";
      const punchEdge = (len, horizontal, fixed) => {
        const n = Math.max(2, Math.round(len / (r * 3.2)));
        const step = len / n;
        for (let i = 0; i <= n; i++) {
          const t = i * step;
          g.beginPath();
          if (horizontal) g.arc(t, fixed, r, 0, Math.PI * 2);
          else g.arc(fixed, t, r, 0, Math.PI * 2);
          g.fill();
        }
      };
      punchEdge(c.width, true, 0);
      punchEdge(c.width, true, c.height);
      punchEdge(c.height, false, 0);
      punchEdge(c.height, false, c.width);
      g.globalCompositeOperation = "source-over";
      g.drawImage(media.el, p, p, iw, ih);
      // Thin inner border like a printed stamp.
      g.strokeStyle = "rgba(255,255,255,.9)";
      g.lineWidth = Math.max(2, p * 0.08);
      g.strokeRect(p * 0.55, p * 0.55, c.width - p * 1.1, c.height - p * 1.1);
      break;
    }

    case "circle": {
      const d = S;                       // center-cropped circle
      const ring = Math.round(d * 0.05);
      c.width = c.height = d + ring * 2;
      const cx = c.width / 2;
      g.beginPath();
      g.arc(cx, cx, d / 2 + ring, 0, Math.PI * 2);
      g.fillStyle = "#fff";
      g.fill();
      // Center-crop the image inside the circle.
      g.save();
      g.beginPath();
      g.arc(cx, cx, d / 2, 0, Math.PI * 2);
      g.clip();
      g.drawImage(media.el, cx - iw / 2, cx - ih / 2, iw, ih);
      g.restore();
      break;
    }

    default: { // "none"
      c.width = iw; c.height = ih;
      g.drawImage(media.el, 0, 0);
    }
  }

  ov.framed = c;
  ov.fw = c.width;
  ov.fh = c.height;
}

function deleteOverlay(id) {
  const post = activePost();
  if (!post) return;
  post.overlays = post.overlays.filter((o) => o.id !== id);
  if (state.selectedOverlayId === id) state.selectedOverlayId = null;
  syncOverlayPanel();
  renderPostList();
}

/* ---------------- rendering ---------------- */

function drawCover(g, el, mw, mh, W, H) {
  if (!mw || !mh) return;
  const s = Math.max(W / mw, H / mh);
  const dw = mw * s, dh = mh * s;
  g.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/** Draw a full post frame (background + overlays) into g at W×H. */
function drawScene(g, W, H, post) {
  g.fillStyle = post.bgColor || "#000";
  g.fillRect(0, 0, W, H);

  const bg = getMedia(post.bgId);
  if (bg) drawCover(g, bg.el, bg.width, bg.height, W, H);

  for (const ov of post.overlays) {
    if (!ov.framed) buildFramed(ov);
    if (!ov.framed) continue;
    const w = ov.fw * ov.scale, h = ov.fh * ov.scale;
    g.save();
    g.translate(ov.x, ov.y);
    g.rotate(ov.rotation);
    if (ov.shadow) {
      g.shadowColor = "rgba(0,0,0,.45)";
      g.shadowBlur = Math.round(H * 0.02);
      g.shadowOffsetX = Math.round(H * 0.004);
      g.shadowOffsetY = Math.round(H * 0.008);
    }
    g.drawImage(ov.framed, -w / 2, -h / 2, w, h);
    g.restore();
  }
}

/**
 * Draw a post into a target of arbitrary size (used by "export all" where
 * posts may have different aspect ratios than the recording canvas).
 */
let fitCanvas = null;
function drawSceneFit(g, W, H, post) {
  const [pw, ph] = ASPECTS[post.aspect] || [W, H];
  if (pw === W && ph === H) {
    drawScene(g, W, H, post);
    return;
  }
  fitCanvas = fitCanvas || document.createElement("canvas");
  if (fitCanvas.width !== pw || fitCanvas.height !== ph) {
    fitCanvas.width = pw; fitCanvas.height = ph;
  }
  drawScene(fitCanvas.getContext("2d"), pw, ph, post);
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  drawCover(g, fitCanvas, pw, ph, W, H);
}

/* selection chrome (preview only) */
function overlayCorners(ov) {
  const w = ov.fw * ov.scale / 2, h = ov.fh * ov.scale / 2;
  const cos = Math.cos(ov.rotation), sin = Math.sin(ov.rotation);
  const pt = (dx, dy) => ({ x: ov.x + dx * cos - dy * sin, y: ov.y + dx * sin + dy * cos });
  return {
    tl: pt(-w, -h), tr: pt(w, -h), br: pt(w, h), bl: pt(-w, h),
    top: pt(0, -h), rotate: pt(0, -h - 90),
  };
}

function drawSelection(g) {
  const ov = selectedOverlay();
  if (!ov || !ov.framed) return;
  const c = overlayCorners(ov);
  const lw = Math.max(2, canvas.width / 400);

  g.save();
  g.strokeStyle = "#6c5ce7";
  g.fillStyle = "#fff";
  g.lineWidth = lw;

  g.beginPath();
  g.moveTo(c.tl.x, c.tl.y);
  g.lineTo(c.tr.x, c.tr.y);
  g.lineTo(c.br.x, c.br.y);
  g.lineTo(c.bl.x, c.bl.y);
  g.closePath();
  g.stroke();

  // rotate stem + handle
  g.beginPath();
  g.moveTo(c.top.x, c.top.y);
  g.lineTo(c.rotate.x, c.rotate.y);
  g.stroke();

  const hr = handleRadius();
  for (const p of [c.tl, c.tr, c.br, c.bl]) {
    g.beginPath();
    g.arc(p.x, p.y, hr, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.beginPath();
  g.arc(c.rotate.x, c.rotate.y, hr * 1.15, 0, Math.PI * 2);
  g.fillStyle = "#6c5ce7";
  g.fill();
  g.restore();
}

function handleRadius() {
  // Constant on-screen size regardless of canvas zoom; larger for fingers.
  const rect = canvas.getBoundingClientRect();
  return (isTouch ? 13 : 9) * (canvas.width / Math.max(1, rect.width));
}

/* main loop */
let exportingPost = null; // when set, the loop renders this post w/o selection UI

function tick() {
  const post = exportingPost || activePost();
  if (post) {
    if (exportingPost) {
      drawSceneFit(ctx, canvas.width, canvas.height, post);
    } else {
      drawScene(ctx, canvas.width, canvas.height, post);
      drawSelection(ctx);
    }
  } else {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // First-run guidance stays up until the post has any content.
  const showWelcome = !exportingPost && post && !post.bgId && post.overlays.length === 0;
  if (welcomeOverlay.hidden === showWelcome) welcomeOverlay.hidden = !showWelcome;

  requestAnimationFrame(tick);
}

/* ---------------- pointer interaction ---------------- */

let drag = null;  // {mode:'move'|'scale'|'rotate', ...}
let pinch = null; // two-finger resize/rotate: {ov, baseDist, baseAngle, baseScale, baseRotation}
const activePointers = new Map(); // pointerId -> canvas point

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function hitOverlay(post, pt) {
  // Topmost first.
  for (let i = post.overlays.length - 1; i >= 0; i--) {
    const ov = post.overlays[i];
    if (!ov.framed) continue;
    const dx = pt.x - ov.x, dy = pt.y - ov.y;
    const cos = Math.cos(-ov.rotation), sin = Math.sin(-ov.rotation);
    const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
    if (Math.abs(lx) <= ov.fw * ov.scale / 2 && Math.abs(ly) <= ov.fh * ov.scale / 2) {
      return ov;
    }
  }
  return null;
}

canvas.addEventListener("pointerdown", (e) => {
  if (exportingPost) return;
  const post = activePost();
  if (!post) return;
  const pt = canvasPoint(e);
  canvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, pt);

  // A second finger starts a pinch on the selected image.
  if (activePointers.size === 2) {
    const ov = selectedOverlay() || (drag && drag.ov);
    if (ov) {
      const [a, b] = [...activePointers.values()];
      pinch = {
        ov,
        baseDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        baseAngle: Math.atan2(b.y - a.y, b.x - a.x),
        baseScale: ov.scale,
        baseRotation: ov.rotation,
      };
      drag = null;
    }
    return;
  }
  if (activePointers.size > 2) return;

  const sel = selectedOverlay();
  if (sel && sel.framed) {
    const c = overlayCorners(sel);
    const hr = handleRadius() * 1.6; // generous grab area
    const near = (p) => Math.hypot(pt.x - p.x, pt.y - p.y) <= hr;

    if (near(c.rotate)) {
      drag = { mode: "rotate", ov: sel };
      return;
    }
    for (const corner of [c.br, c.tr, c.bl, c.tl]) {
      if (near(corner)) {
        drag = {
          mode: "scale", ov: sel,
          baseDist: Math.hypot(pt.x - sel.x, pt.y - sel.y),
          baseScale: sel.scale,
        };
        return;
      }
    }
  }

  const hit = hitOverlay(post, pt);
  if (hit) {
    state.selectedOverlayId = hit.id;
    drag = { mode: "move", ov: hit, offX: pt.x - hit.x, offY: pt.y - hit.y };
  } else {
    state.selectedOverlayId = null;
    drag = null;
  }
  syncOverlayPanel();
});

canvas.addEventListener("pointermove", (e) => {
  if (exportingPost) return;
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, canvasPoint(e));
  }

  if (pinch && activePointers.size >= 2) {
    const [a, b] = [...activePointers.values()];
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    pinch.ov.scale = Math.min(6, Math.max(0.03, pinch.baseScale * (dist / pinch.baseDist)));
    pinch.ov.rotation = pinch.baseRotation + (angle - pinch.baseAngle);
    syncOverlayPanel(true);
    return;
  }

  if (!drag) return;
  const pt = canvasPoint(e);
  const ov = drag.ov;

  if (drag.mode === "move") {
    ov.x = pt.x - drag.offX;
    ov.y = pt.y - drag.offY;
  } else if (drag.mode === "scale") {
    const d = Math.hypot(pt.x - ov.x, pt.y - ov.y);
    if (drag.baseDist > 1) {
      ov.scale = Math.min(6, Math.max(0.03, drag.baseScale * (d / drag.baseDist)));
    }
    syncOverlayPanel(true);
  } else if (drag.mode === "rotate") {
    ov.rotation = Math.atan2(pt.y - ov.y, pt.x - ov.x) + Math.PI / 2;
    syncOverlayPanel(true);
  }
});

const endDrag = (e) => {
  activePointers.delete(e.pointerId);
  if (pinch && activePointers.size < 2) pinch = null;
  if (activePointers.size === 0) drag = null;
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// Mouse-wheel resizes the selected overlay.
canvas.addEventListener("wheel", (e) => {
  const ov = selectedOverlay();
  if (!ov || exportingPost) return;
  e.preventDefault();
  const k = e.deltaY < 0 ? 1.06 : 1 / 1.06;
  ov.scale = Math.min(6, Math.max(0.03, ov.scale * k));
  syncOverlayPanel(true);
}, { passive: false });

// Keyboard: delete / nudge.
window.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const ov = selectedOverlay();
  if (!ov || exportingPost) return;

  const step = e.shiftKey ? 20 : 4;
  switch (e.key) {
    case "Delete":
    case "Backspace": deleteOverlay(ov.id); e.preventDefault(); break;
    case "ArrowLeft": ov.x -= step; e.preventDefault(); break;
    case "ArrowRight": ov.x += step; e.preventDefault(); break;
    case "ArrowUp": ov.y -= step; e.preventDefault(); break;
    case "ArrowDown": ov.y += step; e.preventDefault(); break;
  }
});

/* ---------------- panels ---------------- */

function syncPostPanel() {
  const post = activePost();
  if (!post) return;
  postNameInput.value = post.name;
  bgColorInput.value = post.bgColor;
  stillDurationInput.value = post.stillDuration;
  const bg = getMedia(post.bgId);
  if (bg) {
    bgInfo.textContent = `${bg.type === "video" ? "🎞" : "🖼"} ${bg.name}`;
    bgInfo.classList.add("set");
  } else {
    bgInfo.textContent = "None — pick media on the left and press “BG”";
    bgInfo.classList.remove("set");
  }
}

/** @param {boolean} light only refresh slider values (used during drags) */
function syncOverlayPanel(light = false) {
  const ov = selectedOverlay();
  overlayProps.hidden = !ov;
  if (!ov) return;

  scaleInput.value = ov.scale;
  scaleValue.textContent = `${Math.round(ov.scale * 100)}%`;
  const deg = Math.round((ov.rotation * 180) / Math.PI);
  rotationInput.value = Math.max(-180, Math.min(180, deg));
  rotationValue.textContent = `${deg}°`;
  if (light) return;

  shadowInput.checked = ov.shadow;
  captionInput.value = ov.caption;
  captionField.hidden = ov.preset !== "polaroid";
  for (const btn of presetButtons.querySelectorAll(".preset-btn")) {
    btn.classList.toggle("active", btn.dataset.preset === ov.preset);
  }
}

/* panel events */

postNameInput.addEventListener("input", () => {
  const post = activePost();
  if (!post) return;
  post.name = postNameInput.value;
  renderPostList();
});

bgColorInput.addEventListener("input", () => {
  const post = activePost();
  if (post) post.bgColor = bgColorInput.value;
});

$("#bg-clear-btn").addEventListener("click", () => {
  const post = activePost();
  if (!post) return;
  post.bgId = null;
  syncBackgroundPlayback();
  syncPostPanel();
  renderPostList();
});

stillDurationInput.addEventListener("input", () => {
  const post = activePost();
  if (post) post.stillDuration = Math.max(1, parseFloat(stillDurationInput.value) || 5);
});

aspectSelect.addEventListener("change", () => {
  const post = activePost();
  if (!post) return;
  post.aspect = aspectSelect.value;
  applyCanvasSize(post.aspect);
  renderPostList();
});

presetButtons.addEventListener("click", (e) => {
  const btn = e.target.closest(".preset-btn");
  const ov = selectedOverlay();
  if (!btn || !ov) return;
  ov.preset = btn.dataset.preset;
  buildFramed(ov);
  syncOverlayPanel();
});

captionInput.addEventListener("input", () => {
  const ov = selectedOverlay();
  if (!ov) return;
  ov.caption = captionInput.value;
  buildFramed(ov);
});

scaleInput.addEventListener("input", () => {
  const ov = selectedOverlay();
  if (!ov) return;
  ov.scale = parseFloat(scaleInput.value);
  scaleValue.textContent = `${Math.round(ov.scale * 100)}%`;
});

rotationInput.addEventListener("input", () => {
  const ov = selectedOverlay();
  if (!ov) return;
  ov.rotation = (parseFloat(rotationInput.value) * Math.PI) / 180;
  rotationValue.textContent = `${rotationInput.value}°`;
});

shadowInput.addEventListener("change", () => {
  const ov = selectedOverlay();
  if (ov) ov.shadow = shadowInput.checked;
});

$("#layer-up-btn").addEventListener("click", () => moveLayer(1));
$("#layer-down-btn").addEventListener("click", () => moveLayer(-1));

function moveLayer(dir) {
  const post = activePost();
  const ov = selectedOverlay();
  if (!post || !ov) return;
  const i = post.overlays.indexOf(ov);
  const j = i + dir;
  if (j < 0 || j >= post.overlays.length) return;
  [post.overlays[i], post.overlays[j]] = [post.overlays[j], post.overlays[i]];
}

$("#duplicate-btn").addEventListener("click", () => {
  const post = activePost();
  const ov = selectedOverlay();
  if (!post || !ov) return;
  const copy = { ...ov, id: nextId(), x: ov.x + 40, y: ov.y + 40, framed: null };
  buildFramed(copy);
  post.overlays.push(copy);
  state.selectedOverlayId = copy.id;
  syncOverlayPanel();
  renderPostList();
});

$("#delete-overlay-btn").addEventListener("click", () => {
  const ov = selectedOverlay();
  if (ov) deleteOverlay(ov.id);
});

/* ---------------- file input / drag & drop ---------------- */

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

for (const evt of ["dragenter", "dragover"]) {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
}
for (const evt of ["dragleave", "drop"]) {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
  });
}
dropZone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
// Also accept drops anywhere on the page.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

/* ---------------- export: image ---------------- */

$("#export-image-btn").addEventListener("click", async () => {
  const post = activePost();
  if (!post) return;
  const [W, H] = ASPECTS[post.aspect];
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  drawScene(out.getContext("2d"), W, H, post);
  out.toBlob((blob) => {
    if (!blob) return toast("PNG export failed");
    download(blob, `${safeName(post.name)}.png`);
    toast("PNG saved — ready for Instagram 🎉");
  }, "image/png");
});

/* ---------------- export: video ---------------- */

let audioCtx = null;
let exportCancelled = false;

function pickMimeType() {
  // Prefer H.264+AAC in MP4 (what Instagram wants), then any MP4, then WebM.
  const candidates = [
    'video/mp4;codecs="avc1.640028,mp4a.40.2"',
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    "video/mp4",
    'video/webm;codecs="vp9,opus"',
    "video/webm",
  ];
  for (const t of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

/** Route a media element's audio into the export stream. Safe to call repeatedly. */
function getAudioNode(media) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (!media.audioNode) {
      media.audioNode = audioCtx.createMediaElementSource(media.el);
    }
    return media.audioNode;
  } catch (err) {
    console.warn("audio capture unavailable:", err);
    return null;
  }
}

function seekTo(video, t) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener("seeked", done); resolve(); };
    video.addEventListener("seeked", done);
    video.currentTime = t;
    // Fallback in case 'seeked' never fires (e.g. already at t).
    setTimeout(done, 1500);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showExportUI(show, status = "Recording…") {
  exportOverlay.hidden = !show;
  exportStatus.textContent = status;
  for (const id of ["export-image-btn", "export-video-btn", "export-all-btn", "add-post-btn"]) {
    const el = document.getElementById(id);
    if (el) el.disabled = show;
  }
}

$("#export-cancel-btn").addEventListener("click", () => {
  exportCancelled = true;
  exportStatus.textContent = "Cancelling…";
});

/**
 * Records `posts` back-to-back into a single video file using the visible
 * canvas as the recording surface. A post with a video background plays
 * through once; other posts are held for post.stillDuration seconds.
 */
async function recordPosts(posts, filename) {
  if (!window.MediaRecorder) {
    toast("MediaRecorder is not supported in this browser");
    return;
  }
  const mimeType = pickMimeType();
  if (!mimeType) {
    toast("No supported video recording format found in this browser");
    return;
  }

  exportCancelled = false;
  const prevAspect = activePost()?.aspect || "4:5";

  // Recording dimensions come from the first post.
  applyCanvasSize(posts[0].aspect);
  state.selectedOverlayId = null;
  syncOverlayPanel();

  // Video track from the canvas, audio (if any) mixed via WebAudio.
  const videoStream = canvas.captureStream(EXPORT_FPS);
  const tracks = [...videoStream.getVideoTracks()];

  const usesAudio = posts.some((p) => getMedia(p.bgId)?.type === "video");
  let mixDest = null;
  if (usesAudio) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      mixDest = audioCtx.createMediaStreamDestination();
      tracks.push(...mixDest.stream.getAudioTracks());
    } catch (err) {
      console.warn("audio mixing unavailable:", err);
    }
  }

  const recorder = new MediaRecorder(new MediaStream(tracks), {
    mimeType,
    videoBitsPerSecond: VIDEO_BPS,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => (recorder.onstop = res));

  showExportUI(true, "Recording…");
  recorder.start(200);

  const restore = [];
  try {
    for (let i = 0; i < posts.length; i++) {
      if (exportCancelled) break;
      const post = posts[i];
      const label = posts.length > 1 ? ` (${i + 1}/${posts.length})` : "";
      exportingPost = post;
      const bg = getMedia(post.bgId);

      if (bg?.type === "video") {
        const v = bg.el;
        const wasMuted = v.muted, wasLoop = v.loop;
        restore.push(() => { v.muted = wasMuted; v.loop = wasLoop; });

        let node = null;
        if (mixDest) {
          node = getAudioNode(bg);
          if (node) { node.connect(mixDest); v.muted = false; v.volume = 1; }
        }

        const dur = bg.duration || 0;
        let t0 = performance.now();
        const ticker = setInterval(() => {
          const s = ((performance.now() - t0) / 1000).toFixed(1);
          exportStatus.textContent = `Recording “${post.name}”${label} — ${s}s / ${dur ? dur.toFixed(1) + "s" : "…"}`;
        }, 200);

        // Play the clip through once. Chrome can land a seek at the very end
        // of some files (notably recorder-produced WebM with no cue index),
        // firing 'ended' immediately — retry the play-through when that happens.
        for (let attempt = 0; attempt < 3; attempt++) {
          v.pause();
          v.loop = false;
          await seekTo(v, 0);
          const ended = new Promise((res) => v.addEventListener("ended", res, { once: true }));
          t0 = performance.now();
          await v.play();
          let settled = false;
          await Promise.race([
            ended,
            (async () => { while (!exportCancelled && !settled) await sleep(150); })(),
          ]);
          settled = true;
          const elapsed = (performance.now() - t0) / 1000;
          if (exportCancelled || dur <= 0.5 || elapsed >= Math.min(1, dur * 0.5)) break;
        }
        clearInterval(ticker);
        v.pause();
        if (node) node.disconnect(mixDest);
      } else {
        // Still post: hold the frame for stillDuration seconds.
        const holdMs = (post.stillDuration || 5) * 1000;
        const t0 = performance.now();
        while (performance.now() - t0 < holdMs && !exportCancelled) {
          const s = ((performance.now() - t0) / 1000).toFixed(1);
          exportStatus.textContent = `Recording “${post.name}”${label} — ${s}s / ${(holdMs / 1000).toFixed(1)}s`;
          await sleep(100);
        }
      }
    }
  } finally {
    recorder.stop();
    await stopped;
    for (const fn of restore) fn();
    exportingPost = null;
    applyCanvasSize(prevAspect);
    syncBackgroundPlayback();
    showExportUI(false);
  }

  if (exportCancelled) {
    toast("Export cancelled");
    return;
  }

  const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
  download(blob, `${filename}.${ext}`);
  toast(
    ext === "mp4"
      ? "MP4 saved — ready for Instagram 🎉"
      : "WebM saved. Instagram needs MP4 — convert it (e.g. with ffmpeg or an online converter), or use Chrome 126+ which records MP4 directly."
  , 6000);
}

$("#export-video-btn").addEventListener("click", async () => {
  const post = activePost();
  if (!post) return;
  await recordPosts([post], safeName(post.name));
});

$("#export-all-btn").addEventListener("click", async () => {
  if (!state.posts.length) return;
  await recordPosts(state.posts, "instapost_reel");
});

/* ---------------- help modal ---------------- */

function setHelpOpen(open) {
  helpModal.hidden = !open;
}
$("#help-btn").addEventListener("click", () => setHelpOpen(true));
$("#help-close-btn").addEventListener("click", () => setHelpOpen(false));
helpModal.querySelector(".modal-backdrop").addEventListener("click", () => setHelpOpen(false));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !helpModal.hidden) setHelpOpen(false);
});

/* ---------------- mobile tab bar ---------------- */

function showTab(name) {
  document.body.classList.toggle("show-left", name === "media");
  document.body.classList.toggle("show-right", name === "edit");
  for (const btn of mobileTabs.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.tab === name);
  }
}
mobileTabs.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn) showTab(btn.dataset.tab);
});
// Tapping the canvas area collapses any open sheet on phones.
canvas.addEventListener("pointerdown", () => {
  if (isPhoneLayout() && (document.body.classList.contains("show-left") || document.body.classList.contains("show-right"))) {
    showTab("canvas");
  }
});

/* ---------------- init ---------------- */

$("#add-post-btn").addEventListener("click", () => createPost());
$("#welcome-add-btn").addEventListener("click", () => fileInput.click());

createPost();
applyCanvasSize("4:5");
requestAnimationFrame(tick);
