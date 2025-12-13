#!/usr/bin/env bash
set -euo pipefail

# Écrire GOOGLE_APPLICATION_CREDENTIALS à partir de GOOGLE_APPLICATION_CREDENTIALS_JSON (sans toucher app.py)
if [ -n "${GOOGLE_APPLICATION_CREDENTIALS_JSON:-}" ]; then
  TMPKEY="${TMPDIR:-/tmp}/firebase-key.json"
  printf '%s' "$GOOGLE_APPLICATION_CREDENTIALS_JSON" > "$TMPKEY"
  chmod 600 "$TMPKEY"
  export GOOGLE_APPLICATION_CREDENTIALS="$TMPKEY"
  echo "Wrote Firebase key to $TMPKEY and set GOOGLE_APPLICATION_CREDENTIALS"
else
  if [ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
    echo "Erreur : aucune variable GOOGLE_APPLICATION_CREDENTIALS ni GOOGLE_APPLICATION_CREDENTIALS_JSON fournie."
    exit 2
  fi
fi

# Lancer l'application
exec python app.py
