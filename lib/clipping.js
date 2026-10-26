const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function validateStarts(starts, duration) {
  if (!Array.isArray(starts) || !Number.isFinite(duration) || duration <= 0 || starts.length < 1 || starts.length > 500) throw new Error('Invalid recording duration or song starts.');
  if (starts[0] !== 0) throw new Error('The first song must start at 00:00.');
  for (let i = 0; i < starts.length; i++) {
    if (typeof starts[i] !== 'number' || !Number.isFinite(starts[i]) || starts[i] < 0 || starts[i] >= duration || (i && starts[i] - starts[i - 1] < 0.001)) {
      throw new Error('Song starts must be unique, increasing timestamps inside the recording.');
    }
  }
  return starts.map((start, index) => ({ start, length: (starts[index + 1] ?? duration) - start, name: `${String(index + 1).padStart(2, '0')}.mp4` }));
}

function runClip(input, output, start, length) {
  return new Promise((resolve, reject) => {
    // Input seeking is fast but may start at a nearby keyframe.
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(start), '-i', input, '-t', String(length), '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-f', 'mp4', output];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = '';
    child.stderr.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(errorText.trim() || `FFmpeg exited with code ${code}`)));
  });
}

async function exportClips(input, folder, clips, update) {
  // Never overwrite previous exports: exclusive creation reserves each target pathname.
  const reserved = [];
  try {
    for (const clip of clips) {
      const filepath = path.join(folder, clip.name);
      const handle = await fs.promises.open(filepath, 'wx');
      await handle.close();
      reserved.push(filepath);
    }
  } catch (error) {
    await Promise.all(reserved.map(file => fs.promises.rm(file, { force: true })));
    if (error.code === 'EEXIST') throw new Error('The selected folder already contains numbered clips. Choose another folder or move those files first.');
    throw error;
  }
  let completed = 0;
  for (const clip of clips) {
    const output = path.join(folder, clip.name);
    update({ completed, current: clip.name });
    try {
      await runClip(input, output, clip.start, clip.length);
      const stat = await fs.promises.stat(output);
      if (!stat.size) throw new Error('FFmpeg produced an empty file.');
    } catch (error) {
      await fs.promises.rm(output, { force: true });
      throw new Error(`Failed on ${clip.name}: ${error.message}`);
    }
    completed++;
    update({ completed, current: null });
  }
}
module.exports = { validateStarts, exportClips };
