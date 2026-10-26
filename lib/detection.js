const { spawn } = require('node:child_process');

function validateSettings(raw = {}) {
  const threshold = Number(raw.threshold ?? -20);
  const silenceDuration = Number(raw.silenceDuration ?? 1);
  const minSongLength = Number(raw.minSongLength ?? 90);
  if (!Number.isFinite(threshold) || threshold < -60 || threshold > -15 ||
      !Number.isFinite(silenceDuration) || silenceDuration < 0.5 || silenceDuration > 6 ||
      !Number.isFinite(minSongLength) || minSongLength < 30 || minSongLength > 300) {
    throw new Error('Invalid detection settings. Please use the available slider ranges.');
  }
  return { threshold, silenceDuration, minSongLength };
}

function detectSilences(file, settings) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', '-i', file, '-map', '0:a:0', '-vn',
      '-af', `silencedetect=noise=${settings.threshold}dB:d=${settings.silenceDuration}`,
      '-f', 'null', '-'];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    const limit = 8 * 1024 * 1024;
    child.stderr.on('data', data => {
      if (log.length < limit) log += data.toString().slice(0, limit - log.length);
    });
    child.on('error', err => reject(new Error(`Could not launch FFmpeg: ${err.message}`)));
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`FFmpeg analysis failed (code ${code}). ${log.slice(-500)}`));
      const intervals = [];
      const pattern = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g;
      for (const match of log.matchAll(pattern)) {
        intervals.push({ end: Number(match[1]), duration: Number(match[2]) });
      }
      resolve(intervals);
    });
  });
}

function proposeBoundaries(intervals, duration, minSongLength) {
  const boundaries = [0];
  // FFmpeg reports the end of each silence, which is usually closer to the next song's start.
  for (const { end } of [...intervals].sort((a, b) => a.end - b.end)) {
    if (!Number.isFinite(end) || end >= duration || end <= 0) continue;
    if (end - boundaries[boundaries.length - 1] < minSongLength) continue;
    // Avoid proposing a final clip shorter than the minimum song length.
    if (duration - end < minSongLength) continue;
    boundaries.push(Number(end.toFixed(3)));
  }
  return boundaries;
}

async function analyze(file, metadata, rawSettings) {
  const settings = validateSettings(rawSettings);
  if (!metadata.streams.some(stream => stream.type === 'audio')) {
    throw new Error('This video has no audio stream to analyze.');
  }
  if (!(metadata.duration > 0)) throw new Error('The video duration is unavailable.');
  const intervals = await detectSilences(file, settings);
  return { settings, silenceCount: intervals.length, boundaries: proposeBoundaries(intervals, metadata.duration, settings.minSongLength) };
}

module.exports = { analyze, validateSettings, proposeBoundaries };
