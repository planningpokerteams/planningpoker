# Architecture de l’application Planning Poker

## Objectif
L’application permet d’estimer des user stories en équipe via un “planning poker” en ligne :
- création d’une session (organisateur),
- participants qui rejoignent,
- cycles de vote,
- révélation et calcul automatique selon un mode (moyenne/médiane/majorité/strict),
- passage à la story suivante,
- export des résultats.

## Composants
- **Backend** : Flask (`app.py`)
- **Frontend** : templates HTML (`templates/`) + scripts JS (`static/scripts/`)
- **Persistance** : Firestore (collection `sessions` + sous-collections)
- **Tests** : pytest (backend) + jest (frontend)

## Flux utilisateur (parcours)
1. **Accueil** (`GET /`) : entrée vers création ou rejoindre
2. **Créer** (`GET|POST /create`) : l’organisateur définit :
   - nom
   - user stories
   - mode de jeu
   - temps par story
3. **Rejoindre** (`GET|POST /join`) : un participant saisit :
   - session_id
   - nom
4. **Salle d’attente** (`GET /waiting/<session_id>`) :
   - liste des participants
   - démarrage par l’organisateur (`POST /start/<session_id>`)
5. **Vote** (`GET|POST /vote/<session_id>`) :
   - sélection d’une carte / saisie
   - vote enregistré
   - révélation (`POST /reveal/<session_id>`)
   - calcul + résultat
6. **Tour suivant** (`POST /next_story/<session_id>`) :
   - incrémente l’index
   - termine la partie si plus de stories
7. **Export** :
   - état complet JSON (`GET /export_state/<session_id>`)
   - résultats à télécharger (`GET /download_results/<session_id>`)

## Architecture logique

Browser (HTML/JS)
├─ create.html + create.js
├─ join.html
├─ waiting.html + waiting.js
└─ vote.html + vote.js + vote-utils.js
│ HTTP (GET/POST) + polling d’état (API)
▼
Flask (app.py)
├─ routes (create/join/waiting/vote/reveal/next/...)
├─ helpers Firestore (session, participants, chat)
└─ export JSON
▼
Firestore
sessions/{session_id}
├─ fields: status, userStories, currentStoryIndex, gameMode, history...
├─ participants (subcollection)
└─ chat (subcollection)


## Points importants de conception
- **Session ID** : identifiant court généré côté backend (partage facile)
- **État du jeu** : centralisé côté Firestore, afin que tous les clients aient la même source de vérité
- **Règles de décision** : isolées côté JS (vote-utils) ET validées/consommées par le backend
- **Sécurité / robustesse** :
  - gestion des erreurs : session introuvable, actions interdites si non organisateur, etc.
  - export compatible rechargement (reprise via fichier)

## Organisation du code
- `app.py` : cœur backend + routes
- `templates/` : pages HTML (rendu initial)
- `static/scripts/` :
  - `vote.js` : logique vote/refresh UI
  - `vote-utils.js` : calculs (moyenne, médiane, majorité, nearest card)
  - `create.js` / `waiting.js` : logique création et salle d’attente
- `tests/` : validations backend + frontend
