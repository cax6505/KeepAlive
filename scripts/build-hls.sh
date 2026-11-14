#!/usr/bin/env bash
set -euo pipefail

input="${1:-scripts/assets/pexels-cricket-18148072.mp4}"
mkdir -p public/media
ffmpeg -hide_banner -y -stream_loop 21 -i "$input" -t 360 -vf scale=-2:480 -c:v libx264 -preset veryfast \
  -b:v 900k -maxrate 1000k -bufsize 2000k -force_key_frames "expr:gte(t,n_forced*2)" \
  -sc_threshold 0 -an -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename "public/media/seg_%04d.ts" public/media/index.m3u8
