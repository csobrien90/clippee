const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function chooseVideo() {
  // POSIX path conversion allows spaces and non-ASCII file names.
  const script = 'POSIX path of (choose file with prompt "Choose a concert video")';
  try {
    const { stdout } = await run('osascript', ['-e', script]);
    return stdout.trimEnd();
  } catch (err) {
    if (/User canceled|\(-128\)/i.test(err.stderr || '')) return null;
    throw new Error(`Could not open the macOS file picker: ${err.message}`);
  }
}
async function chooseOutputFolder() {
  try {
    const { stdout } = await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose a folder for concert clips")']);
    return stdout.trimEnd();
  } catch (err) {
    if (/User canceled|\(-128\)/i.test(err.stderr || '')) return null;
    throw new Error(`Could not open the macOS folder picker: ${err.message}`);
  }
}
module.exports = { chooseVideo, chooseOutputFolder };
