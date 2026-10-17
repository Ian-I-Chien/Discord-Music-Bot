# 1an's Discord Music Bot

A YouTube music bot that only requires a Discord bot token. Join a voice channel and run `/play link:<YouTube URL>` in a text channel. The bot joins your voice channel and starts playback.

<p>
  <img src="assets/avatar-production.png" width="180" alt="Production vinyl record avatar">
  <img src="assets/avatar-test.png" width="180" alt="Test vinyl record avatar">
</p>

## Features

- Play individual YouTube URLs, import YouTube playlists and Mix snapshots, or search by song name. Search selects the first result and does not guarantee an official recording.
- Now Playing and Up Next embeds with artwork, track links, artist or uploader, elapsed time, duration, and the next three tracks.
- Pause/resume, skip, and stop buttons. Progress refreshes every 15 seconds.
- Separate queues and voice connections for each Discord server; one active voice channel per server.
- Up to 100 queued tracks and automatic disconnect after two idle minutes. Controls require membership in the bot's voice channel.
- Sends WebM Opus audio without re-encoding in the bot, reducing CPU usage on Raspberry Pi.

## Development and environments

`main` is the only persistent branch. Production and test deployments use the same source revision from `main`, with separate local tokens, directories, and services. Create your own feature branch when developing, validate it in the test environment, and merge it into `main` when ready. There is no permanent `test` branch.

The current `main` enables self-deafening when joining voice. This development branch disables self-deafening in the test deployment, imports YouTube playlists and Mix snapshots (including video URLs with a `list` parameter), and publishes the player panel only after audio playback begins. Loading messages, queue-import notices, and technical diagnostics are not posted publicly. Successful command acknowledgements are dismissed; command errors are private to the requester. No real tokens or `.env` files are included in this repository.

## Create and invite your bot

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and obtain its bot token from the Bot page.
2. In the OAuth2 URL Generator, select `bot` and `applications.commands`, using Guild Install.
3. Grant View Channels, Send Messages, Embed Links, Connect, and Speak. Open the generated invite URL and choose your server.
4. Privileged intents such as Message Content are not required.

The bot obtains its application ID after login and registers global commands automatically. No Client ID or Guild ID configuration is required. Registration replaces the application's global commands, so use a dedicated application. Command updates may take time to appear.

## Local installation

Requirements: Node.js 22.12 or newer (Node 24 LTS recommended), Python 3, and Python venv support. Direct installation has been verified on a Raspberry Pi 3 Model B running ARM64 Debian 12.

```sh
git clone https://github.com/Ian-I-Chien/Discord-Music-Bot.git
cd Discord-Music-Bot
python3 -m venv .venv
.venv/bin/pip install -U 'yt-dlp[default]'
npm ci
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_bot_token
```

Start the bot:

```sh
PATH="$PWD/.venv/bin:$PATH" npm start
```

Only `DISCORD_TOKEN` is required. Optionally set `YTDLP_PATH` to an explicit yt-dlp executable path; otherwise it is resolved from PATH. The bot enables Node as the YouTube JavaScript challenge runtime. `yt-dlp[default]` includes the challenge solver.

`npm run register` can update global commands separately, but normal startup already registers them.

## Commands

| Command | Action |
| --- | --- |
| `/play link:<URL or song name>` | Join your voice channel and play, or add to the queue |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/skip` | Skip the current track |
| `/queue` | Display the playback panel and upcoming tracks |
| `/leave` | Clear the queue and disconnect |

Join a regular voice channel first. Stage channels, live streams, Spotify, repeat mode, and restoring queues after a restart are not currently supported. Mix links import a finite snapshot of currently available recommendations; they do not enable endless radio playback. Playlist imports use the available queue capacity (up to 100 waiting tracks); unavailable tracks may be skipped. A video URL containing a `list` parameter imports that playlist. Remove the `list` parameter to play only the video. Bot responses and command descriptions are currently in Traditional Chinese.

## Docker Compose

With Docker Engine and the Compose plugin installed, configure `.env` and run:

```sh
docker compose up -d --build
docker compose logs -f --tail=50
```

To rebuild with updated images and yt-dlp:

```sh
docker compose build --pull --no-cache
docker compose up -d
```

The image includes Node 24, a Python venv, yt-dlp, and FFmpeg. The current direct Opus playback path does not use FFmpeg. The ARM64 Docker build has not been verified; the existing Pi uses direct installation.

## Existing Raspberry Pi deployment

Production and testing run as separate systemd user services:

| Environment | Directory | Service |
| --- | --- | --- |
| Production | `~/youtube-discord-bot` | `youtube-discord-bot` |
| Test | `~/youtube-discord-bot-test` | `youtube-discord-bot-test` |

`activate-pi.sh` is specific to the existing production deployment. It assumes Node is installed at `~/.local/lib/music-node/bin` and the systemd unit already exists. On a new machine, install and configure your own service or use Docker.

```sh
systemctl --user restart youtube-discord-bot
journalctl --user -u youtube-discord-bot -n 50 --no-pager
# Use youtube-discord-bot-test for the test service.
```

Keep each environment's `.env`, venv, and service configuration local when updating source code. Never deploy the test token to production.

## Validation and troubleshooting

```sh
npm test
node --check src/bot.js
```

Tests cover input validation, global command registration, embed payloads, time formatting, and paused/ended control states. Dependency loading, public YouTube source resolution and audio fetching, bot login, and command registration have been verified on the Pi. Audible Discord playback, visual appearance, and the deafen indicator require manual acceptance testing.

- Embeds require Embed Links permission. For missing audio, check Connect, Speak, server mute settings, and outbound UDP connectivity.
- Outbound HTTPS, WebSocket, and UDP access is required. Typical home NAT setups do not need inbound port forwarding.
- YouTube may restrict content by region, account, or source IP. Updating yt-dlp does not resolve every restriction. Cookies are not loaded automatically.
- Unsupported live streams or videos without WebM Opus audio produce an error before the bot attempts the next queued track.
- Raspberry Pi 3 has limited memory; start by testing one voice channel. Audio quality depends on the YouTube source and Discord and is not lossless.

## Secrets and version control

`.gitignore` excludes `.env`, `.env.*`, dependencies, Python environments, logs, and backups. Only the empty `.env.example` template is tracked. Never put tokens in source code, screenshots, commits, or this README. Reset an exposed token immediately in the Developer Portal.
