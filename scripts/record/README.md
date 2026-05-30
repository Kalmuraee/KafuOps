# Demo recordings

Regenerate the landing assets (real recordings of the actual TUI):

```bash
brew install asciinema agg          # one-time
npm run build

# short TUI hero (quickstart + dashboard, ~10s)
script -q /dev/null env KAFUOPS_CAST_DIR=/tmp/kc-tui \
  asciinema rec /tmp/kafuops-tui.cast --overwrite --window-size 100x30 \
  -c "bash scripts/record/cast-tui.sh"
agg --speed 1.2 --fps-cap 16 --theme dracula /tmp/kafuops-tui.cast assets/demo/kafuops-tui.gif

# full fix (live model, self-correcting) — uses the provider in
# examples/demo-discount/.kafuops.yml (default: local claude CLI)
script -q /dev/null env KAFUOPS_CAST_DIR=/tmp/kc-fix \
  asciinema rec /tmp/kafuops.cast --overwrite --window-size 100x30 \
  -c "bash scripts/record/cast.sh"
agg --speed 2.8 --fps-cap 14 --theme dracula /tmp/kafuops.cast assets/demo/kafuops.gif

# MP4s for the site (smaller than GIF, used in <video>)
for n in kafuops-tui kafuops; do
  ffmpeg -y -i assets/demo/$n.gif -movflags +faststart -pix_fmt yuv420p \
    -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" assets/demo/$n.mp4
done
```
