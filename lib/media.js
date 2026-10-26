const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration,size,format_name:stream=index,codec_type,codec_name',
    '-of', 'json', file
  ], { maxBuffer: 1024 * 1024 });
  const data = JSON.parse(stdout);
  if (!data.streams?.some(s => s.codec_type === 'video')) {
    throw new Error('The selected file does not contain a video stream.');
  }
  return {
    duration: Number(data.format?.duration) || 0,
    size: Number(data.format?.size) || 0,
    format: data.format?.format_name || 'unknown',
    streams: data.streams.map(({ codec_type, codec_name }) => ({ type: codec_type, codec: codec_name }))
  };
}
module.exports = { probe };
