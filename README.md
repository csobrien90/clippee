# Concert Clipper

Local macOS web app for silence-based detection, boundary editing, and splitting concert recordings into numbered MP4 clips.

## Requirements
- macOS
- Node.js 18+
- FFmpeg and ffprobe on PATH (`brew install ffmpeg`)
- Chrome or Safari (browser playback depends on source codecs)

## Run
From this folder run `npm start` and visit http://127.0.0.1:3333. Stop any older version with Ctrl+C.

## Workflow
1. Choose a concert video with the native macOS picker.
2. Analyze video. Defaults: **−20 dB**, **1 s** silence, **90 s** minimum song length.
3. Review and edit, delete, or add starts. `00:00` is fixed.
4. Click **Clip It** and choose an output folder with the native macOS folder picker.
5. Watch clip-by-clip progress. Files are numbered `01.mp4`, `02.mp4`, and so on.

Exports use FFmpeg stream copy (no re-encoding). Cuts may move to nearby keyframes; MP4 output requires MP4-compatible streams. Export keeps the recording from `00:00` to its end in contiguous requested ranges, subject to keyframe limitations. Numbered files in the chosen folder are **never overwritten**; an existing filename causes an error. On an export failure, previously completed numbered clips are retained and the incomplete output is removed.

The server binds to `127.0.0.1`. Videos are read from their original locations. No remote uploads or external services. Project state and manual edits are not persisted between refreshes. Analysis uses the first audio track.
