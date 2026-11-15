#!/usr/bin/env bash
# Publishes the newest commit on main to the VPS.
#
# bristolbrief-deploy.timer runs this every minute. When main hasn't moved it
# exits after one `git fetch`. When it has (an hourly headline commit, an
# admin save, a code change), it builds a fresh release next to the old one,
# points `.releases/current` at it and restarts the server. A failed build
# leaves the running release alone.
#
#   deploy.sh            deploy if main changed
#   deploy.sh --force    rebuild and restart even if it didn't
#   deploy.sh --rollback <sha>   point current back at an older release
set -euo pipefail

APP="${BRISTOLBRIEF_APP:-/var/www/bristolbrief}"
BRANCH=${BRISTOLBRIEF_BRANCH:-main}
KEEP=5   # releases kept on disk for rollback

cd "$APP"
exec 9>"$APP/.deploy.lock"
flock -n 9 || exit 0   # a build is already running

restart() { sudo /usr/bin/systemctl restart bristolbrief; }

if [ "${1:-}" = "--rollback" ]; then
  sha="${2:?usage: deploy.sh --rollback <sha>}"
  [ -d ".releases/$sha" ] || { echo "No release $sha. Have: $(ls .releases | grep -v current)"; exit 1; }
  ln -sfn "$sha" .releases/current.tmp && mv -T .releases/current.tmp .releases/current
  restart
  echo "Rolled back to $sha"
  exit 0
fi

git fetch --quiet --depth 1 origin "$BRANCH"
new=$(git rev-parse FETCH_HEAD)
cur=$(cat .releases/current/.sha 2>/dev/null || true)
if [ "$new" = "$cur" ] && [ "${1:-}" != "--force" ]; then exit 0; fi

old_lock=$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)
git reset --quiet --hard FETCH_HEAD
new_lock=$(git rev-parse HEAD:package-lock.json)
if [ "$old_lock" != "$new_lock" ] || [ ! -d node_modules ]; then
  npm ci --no-audit --no-fund --loglevel=error
fi

out=".releases/$new"
rm -rf "$out"
start=$(date +%s)
DEPLOY_TARGET=node npx astro build --outDir "$out" >/tmp/bristolbrief-build.log 2>&1 || {
  echo "Build failed for $new; still serving ${cur:-nothing}. Log: /tmp/bristolbrief-build.log"
  tail -20 /tmp/bristolbrief-build.log
  rm -rf "$out"
  exit 1
}
echo "$new" > "$out/.sha"
ln -sfn "$new" .releases/current.tmp && mv -T .releases/current.tmp .releases/current
restart
echo "Deployed $(git log -1 --format='%h %s') in $(( $(date +%s) - start ))s"

# Prune old releases, newest first, never the current one.
ls -1t .releases | grep -vx -e current -e "$new" | tail -n +"$KEEP" | while read -r old; do
  rm -rf ".releases/$old"
done
