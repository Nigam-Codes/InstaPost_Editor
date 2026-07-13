# 📸 InstaPost Editor

A zero-dependency, fully client-side web app for building Instagram posts:
layer your photos on top of a background video (or image), style them with
frame presets, and export the result as an image or a ready-to-post video —
all in the browser, nothing is ever uploaded anywhere.

## Features

- **Media library** — add any number of pictures and videos (click or drag & drop).
- **Video background** — pick any video (or image) as the post background; it is
  auto-fitted (cover) to the canvas.
- **Place images anywhere** — drag to move, corner handles / mouse-wheel to
  resize, top handle to rotate, arrow keys to nudge, `Del` to remove.
- **Frame presets** per image:
  - 🖼 **None** — the plain photo
  - ▢ **Plain** — clean white border
  - 📷 **Polaroid** — classic instant-photo card with a handwritten caption
  - 📮 **Stamp** — postage stamp with perforated edges
  - ⭕ **Circle** — circular badge with a white ring
  - plus drop shadow, layering (front/back), and duplication
- **Instagram canvas formats** — Square 1:1 (1080×1080), Portrait 4:5
  (1080×1350), Reel/Story 9:16 (1080×1920).
- **Multiple posts** — build as many posts as you like and switch between them.
- **Export**
  - **Image (PNG)** — snapshot of the current post.
  - **Post Video** — records the current post for the full length of its
    background video (with its audio) into a single video file.
  - **All Posts → Video** — records every post back-to-back into one video
    file: video-background posts play through once, still posts hold for a
    configurable duration.

## Run it

It's a static site — no build step, no server logic.

```bash
# any static file server works, e.g.:
npx serve .
# or
python3 -m http.server 8000
```

Then open `http://localhost:8000` (opening `index.html` directly from disk
also works in most browsers).

## How to use

1. **Add media** — drop your pictures and videos into the Media Library.
2. Hover a video and press **BG** to make it the post background.
3. Hover a picture and press **+ Add** to place it on the canvas, then drag,
   resize, rotate, and pick a frame preset (add a caption for polaroids).
4. Press **+ New** under *Posts* to start the next post; click a post card to
   switch back at any time.
5. Export:
   - **⬇ Image (PNG)** for a static post,
   - **⬇ Post Video** for the current post,
   - **⬇ All Posts → Video** for one video containing every post in order.

## Notes on the exported video

- Recording uses the browser's `MediaRecorder` on a live canvas.
  **Chrome / Edge 126+** record straight to **MP4 (H.264 + AAC)**, which
  Instagram accepts directly. Other browsers fall back to **WebM** — convert
  it before posting, e.g.:

  ```bash
  ffmpeg -i instapost_reel.webm -c:v libx264 -pix_fmt yuv420p -c:a aac instapost_reel.mp4
  ```

- Recording happens in real time (a 12-second background video takes
  12 seconds to export) — the canvas shows the recording live.
- Background-video audio is captured into the export automatically.
- Instagram specs used: 1080×1080 (feed square), 1080×1350 (feed portrait),
  1080×1920 (Reels/Stories).

## Tech

Vanilla HTML/CSS/JS. Canvas 2D for compositing, offscreen canvases for the
frame presets, `canvas.captureStream()` + `MediaRecorder` for video export,
and the Web Audio API for mixing background-video audio into the recording.
No frameworks, no dependencies, no network calls.
