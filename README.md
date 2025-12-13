# Planning Poker — Iliana & Ruth

Une application Planning Poker en ligne p créee par ABEBE NEGUSSIE Ruth et BENCHIKH Iliana (Groupe H), pour estimer des user stories en équipe. Développée en binôme avec pair programming et intégration continue. L’app permet de créer des parties, voter anonymement, discuter, exporter/importer l’état et reprendre une partie.

Démo
- URL : https://planningpoker-q3jm.onrender.com/  
  Note : sur le plan gratuit Render, l’application peut prendre quelques secondes à « se réveiller ».

Table des matières
- Fonctionnalités
- Règles de jeu et comportements
- Format JSON (import/export)
- Installation & exécution locale (quick start)
- Tests (backend & frontend)
- Organisation du projet (arborescence)
- Dépannage rapide

## 1) Fonctionnalités principales
- Créer une session : organisateur + backlog + mode de jeu + durée par story.
- Rejoindre une session via code + pseudo.
- Deck de vote : 1, 2, 3, 5, 8, 13, ?, ☕ (café/pause).
- Votes masqués jusqu’au reveal par l’organisateur.
- Modes de décision : strict (unanimité), moyenne, médiane, majorité absolue, majorité relative.
- Revote (relancer un tour de vote) et historisation des votes.
- Chronomètre par story et pause automatique si tout le monde choisit `☕`.
- Export complet de l’état (participants, backlog, historique) pour reprise ; export des résultats finaux au format JSON.
- Chat intégré pour discuter avant un revote.
- Actions restreintes à l’organisateur : démarrer la partie, reveal, revote, passer à la story suivante, activer le chat, télécharger l’export JSON.


## 2) Règles de jeu (comportement implémenté)
- Strict (unanimité) : nécessite l’unanimité des votes numériques; 
- Si un autre mode que l'unanimité a été choisit seul le premier tour sera à l'unanimité.
- `?` et `☕` sont ignorés quand on vérifie les votes .
- Si tout le monde choisit `☕`, la partie est mise en pause et l’organisateur peut exporter l’état pour reprise.

  
## 3) Format JSON (exemples)
- Backlog minimal au démarrage (import) :
```json
{
  {
  "schemaVersion": 1,
  "sessionId": "VWKTG9",
  "organizer": "ruru",
  "status": "paused",
  "gameMode": "strict",
  "timePerStory": 5,
  "userStories": [
    "erzfzr"
  ],
  "currentStoryIndex": 0,
  "round_number": 2,
  "history": [],
  "participants": [
    {
      "hasVoted": true,
      "vote": "☕",
      "name": "YOYO",
      "avatarSeed": "astronaut"
    },
    {
      "hasVoted": true,
      "vote": "☕",
      "name": "ruru",
      "avatarSeed": "astronaut"
    }
  ]
}
}
```
- L’export d’état inclut : participants, backlog courant, historique des tours de vote (par story), mode de jeu, status (paused / running), et résultat courant. Ce fichier permet de reprendre exactement une partie.


## 4) Prérequis :
- Python 3.10+
- (Pour tests front) Node.js + npm
- Projet Firebase/Firestore et clé de compte de service (JSON) si vous utilisez la persistance Firestore.

Solution 1 : 
Lancer le  (`start.sh`) pour préparer l’environnement et lancer l’app en développement depuis GIT BASH.

Solution 2 :
Jouer en ligne à : https://planningpoker-q3jm.onrender.com/

Solution 3:

a) Installer et activer un environnement virtuel
# macOS / Linux
python -m venv venv
source venv/bin/activate

# Windows (PowerShell)
python -m venv venv
.\venv\Scripts\Activate.ps1

b) Installer les dépendances Python
pip install -r requirements.txt

c) Configuration Firebase
- Méthode fichier (recommandée) :
  - macOS / Linux :
    export GOOGLE_APPLICATION_CREDENTIALS="/chemin/vers/service-account.json"
  - Windows PowerShell :
    $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\chemin\vers\service-account.json"
- Ou méthode contenu JSON (utile sur Render) :
  - stocker tout le JSON dans la variable `GOOGLE_APPLICATION_CREDENTIALS_JSON`.

d) Démarrage
python app.py
Ouvrir ensuite : http://localhost:5000


## 5) Tests
- Backend (pytest) :
pytest -q

- Frontend (Jest) :
npm install
npm test -- --runInBand


## 6) Arborescence & fichiers importants
- app.py — backend principal (Flask + logique de sessions / persistance).
- static/ — assets front (JS/CSS/images).
- templates/ — pages HTML (Jinja2).
- start.sh — script d’aide pour dev.
- requirements.txt — deps Python.
- package.json + jest.config.cjs — tests front / configuration Node.

## 7) Dépannage rapide
- Erreur « Non autorisé » : vérifiez que vous êtes l’organisateur (même pseudo) et que les cookies sont activés.


