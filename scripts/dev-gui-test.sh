#!/usr/bin/env bash
set -euo pipefail

# Výchozí konfigurace
BRANCH=""
PORT="8000"
DEV_MODE=false
# Načti lokální .env pokud existuje (soubor .env je v .gitignore)
if [ -f .env ]; then
  # export proměnných z .env bez rizika pádu
  set -a
  source .env
  set +a
fi

# Pokud API_KEY stále není definovaný v prostředí ani v .env, použij dynamický dummy klíč
export API_KEY="${API_KEY:-dev-local-dummy-token-for-testing-only-0000}"
export APP_ENV="${APP_ENV:-development}"
export DATABASE_URL="${DATABASE_URL:-sqlite+aiosqlite:///./data_local.db}"

# Nápověda
usage() {
  echo "Použití: $0 [-b branch_name] [-p port] [-d]"
  echo "  -b    Git větev k otestování (volitelné)"
  echo "  -p    Port pro backend (výchozí: 8000)"
  echo "  -d    Spustit Vite dev server místo produkčního buildu (HMR)"
  echo "  -h    Zobrazit nápovědu"
  exit 1
}

# Parsování argumentů
while getopts "b:p:dh" opt; do
  case ${opt} in
    b ) BRANCH="$OPTARG" ;;
    p ) PORT="$OPTARG" ;;
    d ) DEV_MODE=true ;;
    h ) usage ;;
    \? ) usage ;;
  esac
done

# Přepnutí větve pokud je zadána
if [ -n "$BRANCH" ]; then
  echo "==> Přepínám na větev: $BRANCH"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
fi

echo "==> Spouštím migrace databáze přes uv..."
uv run alembic upgrade head

if [ "$DEV_MODE" = true ]; then
  echo "==> Instaluji npm závislosti..."
  npm install
  
  echo "==> Spouštím Backend + Vite Dev server souběžně..."
  # Spustí Vite na pozadí a při Ctrl+C ukončí oba procesy
  npx vite &
  VITE_PID=$!
  trap "kill $VITE_PID 2>/dev/null || true" EXIT
  
  uv run uvicorn app.main:app --reload --port "$PORT"
else
  echo "==> Sestavuji produkční frontend bundle (Vite build)..."
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  npm run build
  
  echo "==> Spouštím Uvicorn na http://localhost:$PORT ..."
  uv run uvicorn app.main:app --reload --port "$PORT"
fi