#!/usr/bin/env bash
set -euo pipefail

input="${1:-scripts/assets/pexels-cricket-18148072.mp4}"
output_dir="${2:-public/media}"
duration_seconds=360
clip_duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$input")"
stream_loops="$(awk -v clip="$clip_duration" -v target="$duration_seconds" 'BEGIN { loops = int(target / clip); if (target / clip > loops) loops++; print loops - 1 }')"
mkdir -p "$output_dir"
ffmpeg -hide_banner -y -stream_loop "$stream_loops" -i "$input" -t "$duration_seconds" -vf scale=-2:480 -c:v libx264 -preset veryfast \
  -b:v 900k -maxrate 1000k -bufsize 2000k -force_key_frames "expr:gte(t,n_forced*2)" \
  -sc_threshold 0 -an -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename "$output_dir/seg_%04d.ts" "$output_dir/index.m3u8"
