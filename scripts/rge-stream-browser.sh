#!/usr/bin/env bash
set -euo pipefail

INPUT_URL="${1:-http://127.0.0.1:3000/output/live}"
DESTINATION="${2:-}"
WIDTH="${3:-1920}"
HEIGHT="${4:-1080}"
FPS="${5:-50}"
VIDEO_BITRATE="${6:-6000k}"
AUDIO_BITRATE="${7:-160k}"
EXTRA_ARGS="${8:-}"

if [ -z "$DESTINATION" ]; then
  echo "ERROR: Missing RTMP/SRT/recording destination" >&2
  exit 2
fi

DISPLAY_ID="${RGE_DISPLAY:-:99}"
export DISPLAY="$DISPLAY_ID"
XVFB_PID=""
CHROME_PID=""
CHROME_PROFILE="/tmp/rge-chrome-profile-$$"

cleanup() {
  if [ -n "${CHROME_PID:-}" ]; then kill "$CHROME_PID" >/dev/null 2>&1 || true; fi
  if [ -n "${XVFB_PID:-}" ]; then kill "$XVFB_PID" >/dev/null 2>&1 || true; fi
  rm -rf "$CHROME_PROFILE" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# Start virtual framebuffer for browser rendering.
Xvfb "$DISPLAY_ID" -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp >/tmp/rge-xvfb.log 2>&1 &
XVFB_PID=$!
sleep 1

CHROME_BIN="${CHROME_BIN:-chromium-browser}"
if ! command -v "$CHROME_BIN" >/dev/null 2>&1; then
  CHROME_BIN="chromium"
fi

"$CHROME_BIN" \
  --no-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --disable-sync \
  --disable-extensions \
  --disable-features=Translate,ChromeWhatsNewUI,SigninPromo,MediaRouter \
  --noerrdialogs \
  --user-data-dir="$CHROME_PROFILE" \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-software-rasterizer \
  --autoplay-policy=no-user-gesture-required \
  --window-size="${WIDTH},${HEIGHT}" \
  --start-fullscreen \
  --kiosk \
  --app="$INPUT_URL" >/tmp/rge-chromium.log 2>&1 &
CHROME_PID=$!
sleep 3

# YouTube recommended baseline: H.264 + AAC in FLV, keyframes every 2 seconds.
GOP=$(( FPS * 2 ))

# shellcheck disable=SC2086
exec ffmpeg \
  -hide_banner -loglevel info \
  -f x11grab -draw_mouse 0 -video_size "${WIDTH}x${HEIGHT}" -framerate "$FPS" -i "$DISPLAY_ID.0" \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -pix_fmt yuv420p -r "$FPS" -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 \
  -b:v "$VIDEO_BITRATE" -maxrate "$VIDEO_BITRATE" -bufsize "$(( ${VIDEO_BITRATE%k} * 2 ))k" \
  -c:a aac -b:a "$AUDIO_BITRATE" -ar 48000 -ac 2 \
  $EXTRA_ARGS \
  -f flv "$DESTINATION"
