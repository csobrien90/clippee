const choose = document.querySelector('#choose');
const clipButton = document.querySelector('#clip-it');
const exportStatus = document.querySelector('#export-status');
const exportProgress = document.querySelector('#export-progress');
let exporting = false;
const player = document.querySelector('#player');
const filename = document.querySelector('#filename');
const metadata = document.querySelector('#metadata');
const position = document.querySelector('#position');
const status = document.querySelector('#status');
const analyzeButton = document.querySelector('#analyze');
const analysisStatus = document.querySelector('#analysis-status');
const boundaries = document.querySelector('#boundaries');
const boundaryCount = document.querySelector('#boundary-count');
const boundaryEmpty = document.querySelector('#boundary-empty');
const addBoundaryButton = document.querySelector('#add-boundary');
const boundaryFeedback = document.querySelector('#boundary-feedback');
const threshold = document.querySelector('#threshold');
const silenceDuration = document.querySelector('#silence-duration');
const minSongLength = document.querySelector('#min-song-length');
let videoGeneration = 0;
let starts = [];
let recordingDuration = NaN;
const EPSILON = 0.001;

function parseTime(value) {
  const parts = value.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || !parts.every(p => /^\d+(?:\.\d+)?$/.test(p))) return NaN;
  if (parts.slice(0, -1).some(p => p.includes('.'))) return NaN;
  const values = parts.map(Number);
  if (values.slice(1).some(v => v >= 60)) return NaN;
  if (values.length === 3 && values[0] < 0) return NaN;
  return values.reduce((acc, n) => acc * 60 + n, 0);
}
function preciseTime(total) {
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = (total % 60).toFixed(3).padStart(6, '0').replace(/\.?0+$/, '');
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(mins).padStart(2, '0')}:${secs.padStart(2, '0')}`;
}
function feedback(text, error = false) {
  boundaryFeedback.textContent = text;
  boundaryFeedback.classList.toggle('error', error);
}
function validBoundary(time, excludeIndex = -1) {
  if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(recordingDuration) || time >= recordingDuration)
    return 'Timestamp must be after 00:00 and before the end of the video.';
  if (starts.some((n, i) => i !== excludeIndex && Math.abs(n - time) < EPSILON))
    return 'That song start already exists.';
  return null;
}

function formatTime(total) {
  if (!Number.isFinite(total)) return '00:00';
  const seconds = Math.floor(total);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).slice(h ? 0 : 1).join(':');
}
function message(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
}
function clearBoundaries() {
  starts = [];
  renderBoundaries();
  feedback('');
}
function renderBoundaries() {
  boundaries.replaceChildren();
  starts.forEach((start, index) => {
    const li = document.createElement('li');
    li.className = 'boundary-item';
    const number = document.createElement('span');
    number.className = 'boundary-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const seek = document.createElement('button');
    seek.type = 'button';
    seek.className = 'timestamp';
    seek.textContent = preciseTime(start);
    seek.title = `Seek to ${preciseTime(start)}`;
    seek.addEventListener('click', () => {
      player.currentTime = start;
      player.pause();
      player.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    li.append(number, seek);
    if (index > 0) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'boundary-action';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => {
        const field = document.createElement('input');
        field.type = 'text';
        field.className = 'timestamp-input';
        field.value = preciseTime(start);
        field.setAttribute('aria-label', `Edit song ${index + 1} start`);
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'boundary-action';
        save.textContent = 'Save';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'boundary-action';
        cancel.textContent = 'Cancel';
        const commit = () => {
          const parsed = parseTime(field.value);
          const error = validBoundary(parsed, index);
          if (error) { feedback(error, true); field.focus(); return; }
          starts[index] = Number(parsed.toFixed(3));
          starts.sort((a, b) => a - b);
          renderBoundaries();
          feedback('Song start updated.');
        };
        save.addEventListener('click', commit);
        cancel.addEventListener('click', renderBoundaries);
        field.addEventListener('keydown', event => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') renderBoundaries();
        });
        li.replaceChildren(number, field, save, cancel);
        field.focus();
        field.select();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'boundary-action delete';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => {
        starts.splice(index, 1);
        renderBoundaries();
        feedback('Song start deleted.');
      });
      li.append(edit, remove);
    } else {
      const fixed = document.createElement('span');
      fixed.className = 'fixed-label';
      fixed.textContent = 'Fixed';
      li.append(fixed);
    }
    boundaries.append(li);
  });
  boundaryCount.textContent = String(starts.length);
  clipButton.disabled = exporting || !(starts.length && recordingDuration > 0);
  boundaryEmpty.hidden = starts.length > 0;
}
function showBoundaries(suggestions) {
  starts = [...new Set(suggestions.map(Number).filter(Number.isFinite))]
    .filter(t => t >= 0 && t < recordingDuration).sort((a, b) => a - b);
  if (starts[0] !== 0) starts.unshift(0);
  renderBoundaries();
  feedback('');
}
addBoundaryButton.addEventListener('click', () => {
  const current = Number(player.currentTime.toFixed(3));
  const error = validBoundary(current);
  if (error) { feedback(error, true); return; }
  if (!starts.length) starts = [0];
  starts.push(current);
  starts.sort((a, b) => a - b);
  renderBoundaries();
  feedback(`Added song start at ${preciseTime(current)}.`);
});
function showVideo(info) {
  videoGeneration++;
  recordingDuration = info.metadata.duration;
  clearBoundaries();
  addBoundaryButton.disabled = !(recordingDuration > 0);
  analysisStatus.textContent = 'Ready to analyze. Choose settings and click Analyze video.';
  analyzeButton.disabled = !info.metadata.streams.some(s => s.type === 'audio');
  filename.textContent = info.name;
  const mb = (info.metadata.size / (1024 * 1024)).toFixed(1);
  metadata.textContent = `${mb} MB · ${info.metadata.streams.filter(s => s.type === 'video').map(s => s.codec).join(', ')}`;
  player.src = `/api/video?v=${Date.now()}`;
  player.load();
  message('Ready. Use the player to preview or seek through the recording.');
}
function showSettings() {
  document.querySelector('#threshold-value').textContent = `${threshold.value} dB`;
  document.querySelector('#silence-value').textContent = `${silenceDuration.value} s`;
  document.querySelector('#song-value').textContent = `${minSongLength.value} s`;
}
for (const input of [threshold, silenceDuration, minSongLength]) input.addEventListener('input', showSettings);
showSettings();
choose.addEventListener('click', async () => {
  choose.disabled = true;
  message('Opening macOS file picker…');
  try {
    const response = await fetch('/api/select', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not open video');
    if (data.canceled) message('Selection canceled.');
    else showVideo(data);
  } catch (err) { message(err.message, true); }
  finally { choose.disabled = false; }
});
analyzeButton.addEventListener('click', async () => {
  const generation = videoGeneration;
  analyzeButton.disabled = true;
  choose.disabled = true;
  clearBoundaries();
  analysisStatus.textContent = 'Analyzing audio… This can take a while for long recordings.';
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threshold: Number(threshold.value),
        silenceDuration: Number(silenceDuration.value),
        minSongLength: Number(minSongLength.value)
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Analysis failed');
    if (generation !== videoGeneration) return;
    showBoundaries(result.boundaries);
    const proposed = result.boundaries.length - 1;
    analysisStatus.textContent = `Found ${result.silenceCount} quiet gap(s); proposed ${proposed} additional song start(s), plus 00:00. Review by clicking timestamps.`;
  } catch (err) { analysisStatus.textContent = `Analysis failed: ${err.message}`; }
  finally { analyzeButton.disabled = false; choose.disabled = false; }
});
player.addEventListener('timeupdate', updatePosition);
player.addEventListener('loadedmetadata', updatePosition);
player.addEventListener('error', () => message('This video could not play in the browser. Its codec may not be supported by your browser.', true));
function updatePosition() { position.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`; }
(async () => {
  try {
    const response = await fetch('/api/video-info');
    const data = await response.json();
    if (data.name) showVideo(data);
  } catch (_) { message('Cannot connect to the local server.', true); }
})();

function exportMessage(text, error = false) {
  exportStatus.textContent = text;
  exportStatus.classList.toggle('error', error);
}
clipButton.addEventListener('click', async () => {
  if (exporting || !starts.length) return;
  // Confirm an in-progress edit has been saved before taking a snapshot.
  if (document.querySelector('.timestamp-input')) {
    exportMessage('Save or cancel the timestamp edit first.', true);
    return;
  }
  exporting = true;
  clipButton.disabled = choose.disabled = analyzeButton.disabled = addBoundaryButton.disabled = true;
  document.querySelectorAll('.boundary-action').forEach(button => { button.disabled = true; });
  exportMessage('Choose an output folder in the macOS dialog…');
  exportProgress.hidden = true;
  try {
    const response = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starts: starts.slice() })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Export could not start.');
    if (data.canceled) { exportMessage('Export canceled.'); return; }
    exportProgress.hidden = false;
    exportProgress.max = data.total;
    exportProgress.value = 0;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const poll = await fetch('/api/export-status', { cache: 'no-store' });
      const job = await poll.json();
      if (!poll.ok) throw new Error(job.error || 'Unable to retrieve export status.');
      if (job.id !== data.id) throw new Error('Export job was replaced.');
      exportProgress.value = job.completed;
      if (job.state === 'complete') {
        exportMessage(`Done! Exported ${job.completed} numbered clip(s) to ${job.folder}`);
        break;
      }
      if (job.state === 'error') throw new Error(`${job.error} (${job.completed} of ${job.total} clips completed; existing completed clips were kept.)`);
      exportMessage(`Exporting ${job.current || 'next clip'} — ${job.completed} / ${job.total} complete`);
    }
  } catch (err) { exportMessage(`Export failed: ${err.message}`, true); }
  finally {
    exporting = false;
    choose.disabled = false;
    analyzeButton.disabled = !(document.querySelector('#player').src && recordingDuration > 0);
    addBoundaryButton.disabled = !(recordingDuration > 0);
    renderBoundaries();
  }
});
