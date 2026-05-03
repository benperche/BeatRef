# BeatRef – Tempo Reference Library

A static web app that helps musicians commit tempos to memory by pairing BPM values with real songs. Open a song, watch the music video, and play a metronome at the same time — your brain anchors the feel of the tempo to music you already know.

**[Live site →](https://benperche.github.io/BeatRef)**

---

## Features

- **Song library** — store songs against BPM values; filter by BPM range, search by title/artist, sort as you like.
- **YouTube embeds** — paste any YouTube URL and the video plays directly in the app. Supports timecodes (e.g. `?t=90`) so you can start at the chorus or the clearest moment.
- **Precise metronome** — built on the Web Audio API scheduler, not `setInterval`, so it never drifts. Adjust BPM live with `−`/`+` buttons (hold for rapid change). Space bar toggles play/stop.
- **Beat visualiser** — a pulsing ring flashes in sync with every click.
- **Tap tempo** — tap a button in rhythm to detect BPM from any song, averaged over up to 8 taps.
- **BPM lookup** — one-click Google search pre-filled with the song name and "BPM".
- **Musical tempo labels** — each BPM shows its Italian marking (Andante, Allegro, Presto…).
- **Persistent storage** — everything lives in `localStorage`; no account or server needed.

## Getting started

Just open `index.html` in a browser — no build step, no dependencies to install. The library comes seeded with six example songs across a range of tempos to get you started.

### Adding a song

1. Click **+ Add Song**.
2. Enter the title, artist, and BPM (or tap **Tap Tempo** in rhythm, then click **Use this BPM**).
3. Paste a YouTube URL. If the most useful part of the song starts mid-way through, paste a timecoded URL (e.g. `https://youtu.be/VIDEO_ID?t=93`) and the embed will start there automatically. You can also override the start time manually.
4. Click **Save Song**.

### Using the metronome

Click any song card to open the player. The YouTube video and metronome are side-by-side:

- Press **Start Metronome** (or hit Space) to start the click.
- Use `−` / `+` to fine-tune the BPM against what you're hearing.
- The adjusted BPM is for your session only — edit the card to save a different value permanently.

## Tech

| Concern | Approach |
|---|---|
| Audio | Web Audio API — `OscillatorNode` + lookahead scheduler |
| Video | YouTube IFrame embed (no API key required) |
| Storage | `localStorage` |
| Fonts | Inter + JetBrains Mono via Google Fonts |
| Hosting | GitHub Pages (static, no build) |

No frameworks, no bundler, no dependencies.

## Seed songs

| Song | Artist | BPM |
|---|---|---|
| Bohemian Rhapsody | Queen | 76 |
| Stayin' Alive | Bee Gees | 104 |
| Eye of the Tiger | Survivor | 109 |
| Billie Jean | Michael Jackson | 117 |
| We're Off to See the Wizard | Judy Garland | 138 |
| Mr. Brightside | The Killers | 148 |

## Licence

MIT
