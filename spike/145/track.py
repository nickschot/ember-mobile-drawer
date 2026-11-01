# Usage: track.py video.mp4 -> per frame (on change): grabber bar y and first text row y (device px)
import subprocess, sys
W, H = 1206, 2622
x0, x1 = 560, 640  # bar columns
cmd = ['ffmpeg', '-v', 'error', '-i', sys.argv[1], '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
n = 0
prev = None
while True:
    buf = p.stdout.read(W * H)
    if len(buf) < W * H:
        break
    bar = None
    for y in range(150, 700):
        seg = buf[y * W + x0:y * W + x1]
        m = sum(seg) / len(seg)
        above = buf[(y - 6) * W + x0:(y - 6) * W + x1]
        if 120 < m < 225 and max(seg) - min(seg) < 40 and min(above) > 235:
            bar = y
            break
    txt = None
    for y in range(150, 900):
        seg = buf[y * W + 60:y * W + 400]
        if min(seg) < 80:
            txt = y
            break
    key = (bar, txt)
    if key != prev:
        print(n, 'bar', bar, 'text', txt)
    prev = key
    n += 1
