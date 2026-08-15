#!/usr/bin/env bash

set -u

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vite_bin="${project_dir}/node_modules/.bin/vite"
dev_host="${AUDIO_DEV_HOST:-127.0.0.1}"
dev_port="${AUDIO_DEV_PORT:-5173}"
server_pid=""
interrupted=0

if [[ ! "${dev_port}" =~ ^[0-9]+$ ]] || ((dev_port < 1 || dev_port > 65535)); then
  printf 'AUDIO_DEV_PORT must be a number from 1 through 65535.\n' >&2
  exit 1
fi

if [[ ! -x "${vite_bin}" ]]; then
  printf 'Vite is not installed. Run "npm install" first.\n' >&2
  exit 1
fi

url_host="${dev_host}"
case "${url_host}" in
  0.0.0.0 | ::)
    url_host="localhost"
    ;;
  *:*)
    url_host="[${url_host}]"
    ;;
esac
dev_url="http://${url_host}:${dev_port}/"

stop_server() {
  local exit_status=$?

  trap - EXIT INT TERM HUP

  if [[ -n "${server_pid}" ]] && kill -0 "${server_pid}" 2>/dev/null; then
    kill "${server_pid}" 2>/dev/null || true
  fi

  if [[ -n "${server_pid}" ]]; then
    wait "${server_pid}" 2>/dev/null || true
  fi

  if ((interrupted)); then
    printf '\nAudio dev server stopped.\n'
  fi

  exit "${exit_status}"
}

handle_interrupt() {
  interrupted=1
  exit 130
}

trap stop_server EXIT
trap handle_interrupt INT TERM HUP

cd "${project_dir}"

printf '\nAudio development server\n'
printf 'Open the app: %s\n' "${dev_url}"
printf 'Press Control-C to stop the server.\n\n'

"${vite_bin}" --host "${dev_host}" --port "${dev_port}" --strictPort --clearScreen false &
server_pid=$!

while kill -0 "${server_pid}" 2>/dev/null; do
  sleep 1
done

wait "${server_pid}"
server_status=$?
server_pid=""
exit "${server_status}"
