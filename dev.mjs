import { spawn } from 'node:child_process'

const processes = [
  spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
]

function stop(code = 0) {
  for (const child of processes) if (child.exitCode === null) child.kill('SIGTERM')
  process.exitCode = code
}

for (const child of processes) {
  child.on('error', error => { console.error(error); stop(1) })
  child.on('exit', code => { if (code && code !== 0) stop(code) })
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
