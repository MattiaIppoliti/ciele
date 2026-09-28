#!/usr/bin/env bash
# Runs the CI jobs that need a Docker daemon on this machine, from the real
# workflow files, with `act`: the self-host contract, both migration replays and
# the web image build. `pnpm verify` covers the rest of CI and skips these,
# because they need Docker. Together the two are what a pull request's checks
# would run, without spending Actions minutes.
#
#   pnpm verify:docker            # every Docker job, against HEAD
#   pnpm verify:docker migrations # one workflow, by file name
#   pnpm verify:docker --changed  # only what this branch's diff from main
#                                 # would trigger in CI (the pre-push hook)
#
# Needs Docker (Colima on macOS: `colima start --mount "$HOME:w"`) and act
# (`brew install act`). It tests the committed HEAD, not the working tree, from
# a throwaway worktree under $HOME: the jobs write files (deploy/.env, ledger
# diffs) and bind-mount the checkout into containers, so the checkout has to be
# a path the Docker VM can see, and it must not be yours.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

command -v act >/dev/null || { echo "verify:docker needs act: brew install act" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "verify:docker needs a running Docker daemon (colima start)" >&2; exit 1; }

# The runner image: act's medium image plus what GitHub's ubuntu-latest has
# and it lacks. Rebuilt only when its Dockerfile changes.
image_tag="ciele-act:$(git hash-object .github/act/Dockerfile | cut -c1-12)"
docker image inspect "$image_tag" >/dev/null 2>&1 \
  || docker build -q -t "$image_tag" .github/act >/dev/null

# workflow file -> jobs. Desktop's Windows leg cannot run here and stays on CI.
# A `case`, not an associative array: macOS still ships bash 3.2.
jobs_of() {
  case "$1" in
    self-host) echo "verify" ;;
    migrations) echo "replay replay-external" ;;
    docker-web) echo "build" ;;
    *) return 1 ;;
  esac
}
# `--changed`: the workflows CI would run for this branch's diff from main,
# mirroring their `paths:` filters. Migrations has no filter in CI (a required
# check must always report), but locally it only matters when the chain or its
# applier moved.
changed_workflows() {
  local base files
  base=$(git merge-base HEAD origin/main 2>/dev/null || echo "")
  [ -n "$base" ] || { echo "self-host migrations docker-web"; return; }
  files=$(git diff --name-only "$base" HEAD)
  local picked=""
  if echo "$files" | grep -qE '^(deploy/|apps/web/(Dockerfile|docker-entrypoint\.sh|vercel\.json|package\.json)$|scripts/apply-migrations|packages/[^/]+/package\.json$|\.github/workflows/self-host\.yml$)'; then
    picked="$picked self-host"
  fi
  if echo "$files" | grep -qE '^(supabase/|ee/migrations/|scripts/apply-migrations|deploy/|\.github/workflows/migrations\.yml$)'; then
    picked="$picked migrations"
  fi
  if echo "$files" | grep -qE '^(apps/web/(Dockerfile|docker-entrypoint\.sh|next\.config\.ts)$|\.dockerignore$|\.github/workflows/docker-web\.yml$)'; then
    picked="$picked docker-web"
  fi
  echo "$picked"
}

if [ "${1:-}" = "--changed" ]; then
  # shellcheck disable=SC2207
  selected=($(changed_workflows))
  if [ ${#selected[@]} -eq 0 ]; then
    echo "verify:docker: nothing in this branch touches a Docker job, skipping"
    exit 0
  fi
else
  selected=("$@")
  [ $# -gt 0 ] || selected=(self-host migrations docker-web)
fi

work="${HOME}/.cache/ciele-verify-ci/$(git rev-parse --short HEAD)"
rm -rf "$work"
git worktree add --detach --force "$work" HEAD >/dev/null
cleanup() { git worktree remove --force "$work" >/dev/null 2>&1 || rm -rf "$work"; }
trap cleanup EXIT

# A GitHub job starts on a fresh machine; here the daemon is shared, so a job
# that names its containers (ciele-web, external-pg) would collide with the
# previous run's. Everything a job leaves behind is removed after it.
leftovers() { docker ps -aq --no-trunc | sort; }
sweep() {
  local now
  now=$(leftovers)
  comm -13 <(echo "$1") <(echo "$now") | xargs docker rm -f -v >/dev/null 2>&1 || true
  docker network prune -f >/dev/null 2>&1 || true
}

failed=()
for workflow in "${selected[@]}"; do
  job_list=$(jobs_of "$workflow") || { echo "unknown workflow: $workflow" >&2; exit 2; }
  for job in $job_list; do
    echo "::: ${workflow} / ${job}"
    before=$(leftovers)
    # A fresh checkout per job, as on GitHub: jobs write deploy/.env and
    # friends, and one job's leftovers change what the next one generates.
    git -C "$work" reset --hard -q && git -C "$work" clean -fdxq
    # RUNNER_TEMP inside the worktree: steps put files there that they then
    # bind-mount into containers, and only the worktree is a path the Docker
    # VM can see. On GitHub it is a directory on the runner itself.
    mkdir -p "$work/.runner-temp"
    # workflow_dispatch: every job here runs on it, and it never trips the
    # draft-pull-request guard. --bind: the checkout is the worktree itself,
    # so the containers the jobs start can mount its paths.
    if ! (cd "$work" && act workflow_dispatch \
          -W ".github/workflows/${workflow}.yml" -j "$job" \
          -P "ubuntu-latest=${image_tag}" --pull=false --bind \
          --container-daemon-socket unix:///var/run/docker.sock \
          --env "RUNNER_TEMP=$work/.runner-temp"); then
      failed+=("${workflow}/${job}")
    fi
    sweep "$before"
  done
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "verify:docker failed: ${failed[*]}" >&2
  exit 1
fi
echo "verify:docker passed: ${selected[*]}"
