#!/bin/sh
set -eu
cd "$HOME/youtube-discord-bot"
export PATH="$HOME/.local/lib/music-node/bin:$HOME/youtube-discord-bot/.venv/bin:$PATH"
node --env-file=.env --input-type=module -e '
for (const key of ["DISCORD_TOKEN"]) {
  if (!process.env[key]?.trim()) throw new Error(`請先在 .env 填入 ${key}`);
}'
systemctl --user daemon-reload
systemctl --user reset-failed youtube-discord-bot 2>/dev/null || true
systemctl --user enable youtube-discord-bot
systemctl --user restart youtube-discord-bot
systemctl --user --no-pager status youtube-discord-bot
