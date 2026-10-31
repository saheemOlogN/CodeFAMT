const { execFileSync } = require('node:child_process');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbidden = files.filter(file => /(^|\/)(node_modules|dist|coverage|\.local-backups)\//.test(file) ||
  /(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.env.example') || /\.(pem|key|log)$/.test(file));
if (forbidden.length) {
  console.error('Remove generated files or private configuration from Git tracking:\n' + forbidden.join('\n'));
  process.exitCode = 1;
} else console.log('Repository hygiene check passed');
