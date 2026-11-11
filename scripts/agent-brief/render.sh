#!/bin/bash
# Morning Brief video: intro 2.0s, five stories 5.2s each, outro 2.0s = 30.0s.
# Usage: render.sh <buildDir with s00..s06 stills> <output.mp4>
set -euo pipefail
cd "${1:-$(dirname "$0")/build}"
OUT="${2:-makaug-morning-brief.mp4}"
[ -f bar.png ] || python3 -c "from PIL import Image; Image.new('RGB',(187,10),(0x15,0x80,0x3D)).save('bar.png')"
ENC="-r 30 -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p -profile:v high -level 4.0"
rm -f list.txt

# Intro: no fade-in, so WhatsApp's thumbnail (the first frame) shows the title.
ffmpeg -y -loglevel error -framerate 30 -i s00.jpg -vf "format=yuv420p,loop=-1:1,trim=duration=2.0,setpts=N/30/TB" $ENC tmp_c00.mp4
mv tmp_c00.mp4 c00.mp4; echo "file 'c00.mp4'" >> list.txt

# Stories: A (the story) for 1.5s, crossfade 0.35s into B (+ what it means), progress bar fills over 5.2s.
for i in 1 2 3 4 5; do
  n=$(printf "%02d" $i)
  SEGX=$((48 + 199 * (i - 1)))
  ffmpeg -y -loglevel error -framerate 30 -i s${n}a.jpg -framerate 30 -i s${n}b.jpg -framerate 30 -i bar.png -filter_complex "\
[0:v]format=yuv420p,loop=-1:1,trim=duration=1.85,setpts=N/30/TB[a];\
[1:v]format=yuv420p,loop=-1:1,trim=duration=3.70,setpts=N/30/TB[b];\
[a][b]xfade=transition=fade:duration=0.35:offset=1.5,format=yuv420p,split[base][m];\
[m]crop=${SEGX}:14:0:44[mask];\
[2:v]format=yuv420p,loop=-1:1,trim=duration=5.2,setpts=N/30/TB[bar];\
[base][bar]overlay=x='${SEGX}-187+187*t/5.2':y=46:eval=frame[v1];\
[v1][mask]overlay=0:44,trim=duration=5.2[out]" -map "[out]" $ENC tmp_c$n.mp4
  mv tmp_c$n.mp4 c$n.mp4; echo "file 'c$n.mp4'" >> list.txt
done

# Outro: fade to dark at the end.
ffmpeg -y -loglevel error -framerate 30 -i s06.jpg -vf "format=yuv420p,loop=-1:1,trim=duration=2.0,setpts=N/30/TB,fade=t=out:st=1.6:d=0.4:color=0x0F3D2A" $ENC tmp_c06.mp4
mv tmp_c06.mp4 c06.mp4; echo "file 'c06.mp4'" >> list.txt

ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy tmp_joined.mp4 && mv tmp_joined.mp4 joined.mp4
# A silent sound track, so WhatsApp treats it as a video and not a GIF.
ffmpeg -y -loglevel error -i joined.mp4 -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -map 0:v -map 1:a -c:v copy -c:a aac -b:a 64k -shortest -movflags +faststart tmp_final.mp4 && mv tmp_final.mp4 "$OUT"
ls -la "$OUT"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of compact "$OUT"
