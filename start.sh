#!/usr/bin/env bash
set -e

# Dossier du script
cd "$(dirname "$0")"

# Nom du virtualenv
VENV_DIR=".venv"

echo ">>> Détection / création du virtualenv (préférence .venv puis venv)"
# Si .venv n'existe pas mais venv existe, on l'utilise (utile sous Windows)
if [ ! -d "$VENV_DIR" ] && [ -d "venv" ]; then
  VENV_DIR="venv"
fi

if [ ! -d "$VENV_DIR" ]; then
  echo ">>> Création du virtualenv dans $VENV_DIR"
  python -m venv "$VENV_DIR"
fi

echo ">>> Activation du virtualenv"
# Supporte les environnements Unix (bin/activate) et Windows (Scripts/activate)
if [ -f "$VENV_DIR/bin/activate" ]; then
  # Pour bash/zsh (Unix, WSL)
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
elif [ -f "$VENV_DIR/Scripts/activate" ]; then
  # Pour Git-Bash sur Windows ou environnements qui créent Scripts/activate
  # shellcheck disable=SC1091
  source "$VENV_DIR/Scripts/activate"
else
  echo "Erreur: fichier d'activation introuvable dans $VENV_DIR"
  exit 1
fi

echo ">>> Installation des dépendances"
python -m pip install -r requirements.txt


echo ">>> Lancement de l'application Flask"
python app.py
