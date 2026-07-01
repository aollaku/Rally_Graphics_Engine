#!/usr/bin/env bash
set -euo pipefail

VIDEO_INPUT="${1:-rtmp://mediamtx:1935/live}"
GRAPHICS_URL="${2:-http://127.0.0.1:3000/output/live}"
DESTINATION="${3:-}"
WIDTH="${4:-1920}"
HEIGHT="${5:-1080}"
FPS="${6:-50}"
VIDEO_BITRATE="${7:-6000k}"
AUDIO_BITRATE="${8:-160k}"
EXTRA_ARGS="${9:-}"

if [ -z "$DESTINATION" ]; then
  echo "ERROR: Missing YouTube/RTMP destination" >&2
  exit 2
fi

DISPLAY_ID="${RGE_OVERLAY_DISPLAY:-:98}"
export DISPLAY="$DISPLAY_ID"
XVFB_PID=""
CHROME_PID=""
CHROME_PROFILE="/tmp/rge-chrome-profile-$$"
cleanup() {
  [ -n "${CHROME_PID:-}" ] && kill "$CHROME_PID" >/dev/null 2>&1 || true
  [ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" >/dev/null 2>&1 || true
  rm -rf "$CHROME_PROFILE" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

Xvfb "$DISPLAY_ID" -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp >/tmp/rge-overlay-xvfb.log 2>&1 &
XVFB_PID=$!
sleep 1
CHROME_BIN="${CHROME_BIN:-chromium-browser}"
command -v "$CHROME_BIN" >/dev/null 2>&1 || CHROME_BIN="chromium"
"$CHROME_BIN" \
  --no-sandbox --no-first-run --no-default-browser-check --disable-sync --disable-extensions --user-data-dir="$CHROME_PROFILE" --disable-dev-shm-usage --disable-gpu --disable-software-rasterizer \
  --autoplay-policy=no-user-gesture-required --window-size="${WIDTH},${HEIGHT}" \
  --start-fullscreen --kiosk "$GRAPHICS_URL" >/tmp/rge-overlay-chromium.log 2>&1 &
CHROME_PID=$!
sleep 3

GOP=$(( FPS * 2 ))
# The browser graphics layer is keyed over black. Keep the RGE output background transparent/black for overlay workflows.
# shellcheck disable=SC2086
exec ffmpeg -hide_banner -loglevel info \
  -i "$VIDEO_INPUT" \
  -f x11grab -draw_mouse 0 -video_size "${WIDTH}x${HEIGHT}" -framerate "$FPS" -i "$DISPLAY_ID.0" \
  -filter_complex "[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1[base];[1:v]format=rgb24,colorkey=0x000000:0.10:0.08[gfx];[base][gfx]overlay=0:0:format=auto[v]" \
  -map "[v]" -map 0:a? \
  -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p -r "$FPS" \
  -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 -b:v "$VIDEO_BITRATE" -maxrate "$VIDEO_BITRATE" -bufsize "$(( ${VIDEO_BITRATE%k} * 2 ))k" \
  -c:a aac -b:a "$AUDIO_BITRATE" -ar 48000 -ac 2 \
  $EXTRA_ARGS -f flv "$DESTINATION"
