# API Backend – Planning Poker (Flask)

Ce document décrit les routes exposées par `app.py` et leurs comportements
(pages HTML, endpoints JSON, actions, export/import).

---

## 1) Conventions et données communes

### 1.1 Session utilisateur (cookie Flask)

Le backend stocke côté session Flask :
- `session["username"]` : pseudo de l’utilisateur
- `session["session_id"]` : code de la session
- `session["avatarSeed"]` : seed d’avatar

Certaines routes vérifient `session["username"]` (ex : `/vote/<session_id>` redirige vers `/join` si absent).

---

### 1.2 Deck de cartes (valeurs possibles)

Le deck servi à l’UI (variable `CARDS`) contient :
- numériques : `1, 2, 3, 5, 8, 13`
- spéciaux : `"☕"`, `"?"`

---

### 1.3 Données Firestore (collection `sessions`)

Chaque session est un document Firestore : `sessions/{session_id}` avec (au minimum) :
- `organizer` (string)
- `status` (string) : `"waiting" | "started" | "paused" | "finished"`
- `userStories` (list[string])
- `currentStoryIndex` (int)
- `reveal` (bool)
- `final_result` (any|null)
- `history` (list[object])
- `gameMode` (string)
- `round_number` (int)
- `timePerStory` (int) **en minutes**
- `timerStart` (int|null) timestamp UNIX (secondes)

Sous-collections :
- `sessions/{session_id}/participants` : documents participants `{name, vote, avatarSeed, hasVoted}`
- `sessions/{session_id}/chat` : messages `{sender, text, ts}`

---

## 2) Routes “Pages” (HTML)

### 2.1 Accueil
#### `GET /`
Affiche la page d’accueil.

**Réponse** : HTML (`index.html`).

---

### 2.2 Assets (cartes SVG)
#### `GET /asset/<path:filename>`
Renvoie un fichier depuis le dossier local `asset/` (cartes SVG).

**Paramètres URL**
- `filename` : nom du fichier (ex: `cartes_5.svg`)

**Réponse** : fichier (SVG).

---

### 2.3 Créer une partie

#### `GET /create`
Affiche le formulaire de création.

**Réponse** : HTML (`create.html`) avec `avatars=AVATAR_SEEDS`.

#### `POST /create`
Crée une session Firestore, ajoute l’organisateur comme participant, et redirige vers la salle d’attente.

**Form fields**
- `organizer` *(string, requis)* : pseudo organisateur
- `userStories` *(list[string])* : récupéré via `request.form.getlist("userStories")`
- `avatar_seed` *(string, optionnel)* : default `AVATAR_SEEDS[0]`
- `game_mode` *(string, optionnel)* : default `"strict"`
- `timePerStory` *(int, optionnel)* : default `5`, min `1` (**minutes**)
- `resume_file` *(file, optionnel)* : JSON d’état exporté pour reprise (import)

**Comportement**
- génère un `session_id` (6 caractères A-Z0-9) et évite les collisions
- si `resume_file` est fourni et JSON valide :
  - crée une session “reprisée” (history, index, mode, timePerStory…)
  - recrée **optionnellement** les participants depuis l’export
- sinon : crée une session “neuve”
- ajoute l’organisateur **dans tous les cas** comme participant
- stocke `username/session_id/avatarSeed` en session Flask
- **redirige** vers `/waiting/<session_id>`

**Erreurs**
- `400` si `organizer` vide (“Pseudo organisateur requis.”)

**Réponse**
- `302 Redirect` → `/waiting/<session_id>`

---

### 2.4 Rejoindre une partie

#### `GET /join`
Affiche le formulaire de join.

**Réponse** : HTML (`join.html`) avec `avatars=AVATAR_SEEDS`.

#### `POST /join`
Ajoute un participant à une session existante, puis redirige vers la salle d’attente.

**Form fields**
- `code` *(string, requis)* : code session (converti en `upper()`)
- `name` *(string, requis)* : pseudo participant
- `avatar_seed` *(string, optionnel)*

**Comportement**
- vérifie existence session
- ajoute un document participant `{name, vote:null, avatarSeed, hasVoted:false}`
- stocke `username/session_id/avatarSeed` en session Flask
- redirige vers `/waiting/<code>`

**Erreurs**
- `400` si `code` ou `name` manquants (“Code et pseudo requis.”)
- `200` (texte) si code invalide (“Code invalide.”)

**Réponse**
- `302 Redirect` → `/waiting/<session_id>`

---

### 2.5 Salle d’attente
#### `GET /waiting/<session_id>`
Affiche la salle d’attente avec :
- état session (`session`)
- liste brute participants (`participants`)
- utilisateur courant (`current_user`)

**Erreurs**
- `404` si session introuvable (“Session introuvable”)

**Réponse** : HTML (`waiting.html`).

---

### 2.6 Démarrer la partie (organisateur)
#### `POST /start/<session_id>`
Démarre le jeu (réservé à l’organisateur).

**Règle d’accès**
- `session["username"]` doit être égal à `session.organizer`

**Comportement**
- reset tous les votes participants (`vote=None`, `hasVoted=False`)
- met à jour la session :
  - `status="started"`
  - `reveal=False`
  - `round_number=1`
  - `timerStart=now` (timestamp UNIX en secondes)

**Erreurs**
- `404` si session introuvable
- `200` (texte) si non autorisé (“Non autorisé”)

**Réponse**
- `302 Redirect` → `/vote/<session_id>`

---

### 2.7 Page de vote

#### `GET /vote/<session_id>`
Affiche la page de vote.

**Accès**
- si `session["username"]` absent → redirige vers `/join`

**Comportement (masquage des votes)**
- renvoie une version “sanitized” des participants :
  - vote visible si :
    - `session.reveal == True` **OU**
    - utilisateur courant est organisateur **OU**
    - participant == utilisateur courant
  - sinon vote = `null`

**Template data**
- `session` : dict session Firestore
- `participants` : liste sanitized
- `session_id`, `current_user`, `is_organizer`
- `cards` : deck `CARDS`

**Erreurs**
- `404` si session introuvable

**Réponse**
- HTML (`vote.html`)

#### `POST /vote/<session_id>`
Enregistre le vote du joueur courant, puis redirige sur la page de vote.

**Form fields**
- `vote` *(string, requis côté UI)* : valeur vote (ex `"5"`, `"?"`, `"☕"`)

**Comportement**
- met à jour le participant trouvé par `name == username` :
  - `vote=<vote>`
  - `hasVoted=True`
- si participant introuvable (edge case) :
  - ajoute un nouveau doc participant

**Réponse**
- `302 Redirect` → `/vote/<session_id>`

---

### 2.8 Révéler les votes (organisateur)
#### `POST /reveal/<session_id>`
Met `reveal=True` et redirige vers la page vote.

**Règles d’accès**
- réservé à l’organisateur

**Erreurs**
- `404` si session introuvable
- `400` si session déjà terminée (`status == "finished"`) (“Partie terminée”)
- `200` (texte) si non autorisé (“Non autorisé”)

**Réponse**
- `302 Redirect` → `/vote/<session_id>`

---

## 3) Endpoints JSON (API)

### 3.1 Participants (polling waiting)
#### `GET /api/participants/<session_id>`
Renvoie la liste brute des participants + le status.

**Réponse (200)**
```json
{
  "participants": [
    {"name":"Alice","vote":null,"avatarSeed":"astronaut","hasVoted":false}
  ],
  "status": "waiting"
}


**Erreurs**
- `404` + `{"error":"session_not_found"}` si session introuvable.

---

## 3.2 État du jeu (polling vote)
### `GET /api/game/<session_id>`

Renvoie l’état “temps réel” nécessaire au front.

### Calculs inclus
- `currentStory` : story à l’index `currentStoryIndex`
- `allVoted` : tous les votes non `null`
- `allCafe` : tous les votes == `"☕"`
- `unanimous` + `unanimousValue` : unanimité sur les votes en ignorant `"?"` et `"☕"`

### Masquage des votes
Même logique que `/vote/<session_id>` :
- vote visible si `reveal == true`
- ou si l’utilisateur courant est organisateur
- ou si le participant est l’utilisateur courant  
Sinon vote = `null`.

### Gestion pause café (side-effect)
Si `allCafe == true` et que le statut n’est ni `finished` ni déjà `paused` :
- passe `status="paused"`
- met `timerStart=null`
- calcule `pauseRemaining` (secondes restantes sur le timer) si possible
- persiste ces champs en base

### Réponse (200)
```json
{
  "participants": [
    {"name":"Bob","avatarSeed":"ninja","hasVoted":true,"vote":null}
  ],
  "allVoted": false,
  "allCafe": false,
  "unanimous": false,
  "unanimousValue": null,
  "reveal": false,
  "currentStory": "US-01 ...",
  "history": [],
  "gameMode": "strict",
  "roundNumber": 1,
  "timePerStory": 5,
  "timerStart": 1730000000,
  "status": "started"
}


**Erreurs**
- `404` + `{"error":"not_found"}` si session introuvable.

## 3.3 Reprise après pause (café)
### POST /resume/<session_id>

Relance le jeu depuis l’état `"paused"`.

**Comportement**
- si `status != "paused"` → renvoie `{"status":"ignored"}` (200)
- sinon :
  - recalcule `timerStart` pour reprendre le timer (en tenant compte du restant)
  - reset tous les votes
  - met `status="started"` et supprime `pauseRemaining`
  - renvoie `{"status":"ok"}`

**Réponse**
- `200` JSON.

## 3.4 Story suivante / fin de partie
### POST /next_story/<session_id>

Passe à la story suivante ou termine la partie.

**Body JSON**
- `result` *(any, optionnel)* : résultat calculé côté front (ex : médiane / nearest card / etc.)

**Comportement**
Construit un snapshot des votes des participants et l’ajoute à `history` :

```json
{
  "story": "...",
  "result": 5,
  "votes": [
    {"name":"Alice","avatar":"astronaut","vote":"5"},
    {"name":"Bob","avatar":"ninja","vote":"8"}
  ]
}

Si `result` est absent :

- calcule une moyenne simple sur les votes numériques
- ignore `"?"`
- ignore `"☕"` sauf si tous les votes sont `"☕"`

Reset votes pour le tour suivant.

Si des stories restent :
- `currentStoryIndex++`
- `reveal=false`
- `final_result=null`
- `round_number=1`
- `timerStart=now`
- `status="started"`

Sinon (dernière story terminée) :
- `status="finished"`
- `reveal=true`
- `final_result=result`
- `timerStart=null`

Réponse  
- `200` JSON : `{"status":"ok"}`

Erreurs
- `404` JSON : `{"error":"not_found"}`
- `400` JSON : `{"error":"game_finished"}` si déjà fini.

## 3.5 Revote (même story, tour suivant)
### POST /revote/<session_id>

Relance un vote sur la même story (nouveau tour).

Comportement :
- si `status == "finished"` → `400 {"error":"game_finished"}`
- sinon :
  - reset votes
  - `reveal=false`
  - `final_result=null`
  - `round_number += 1`

Réponse  
- `200` JSON : `{"status":"ok"}`

## 3.6 Chat (GET/POST)

### GET /api/chat/<session_id>

Renvoie les messages (max 200), ordonnés par `ts`.

Réponse (200)
```json
{
  "messages": [
    {"sender":"Alice","text":"Hello","ts":1730000000}
  ]
}

**Erreurs**
- `404` JSON : `{"error":"not_found"}`

### POST /api/chat/<session_id>

Ajoute un message au chat.

**Body JSON**
- `text` *(string, requis)*

**Règles**
- nécessite `session["username"]`, sinon `401 {"error":"not_authenticated"}`
- texte vide → `400 {"error":"empty"}`

**Réponse**
- `201` JSON : `{"status":"ok"}`

# 4) Export / Import

## 4.1 Export état complet (sauvegarde)
### GET /export_state/<session_id>

Télécharge un JSON complet incluant participants (utile pour “reprendre une partie”).

**Réponse**
- `application/json` en pièce jointe
- fichier : `poker_state_<session_id>.json`

**Structure (schéma)**
```json
{
  "schemaVersion": 1,
  "sessionId": "ABC123",
  "organizer": "Alice",
  "status": "started",
  "gameMode": "strict",
  "timePerStory": 5,
  "userStories": ["..."],
  "currentStoryIndex": 0,
  "round_number": 1,
  "history": [],
  "participants": [
    {"name":"Alice","vote":null,"avatarSeed":"astronaut","hasVoted":false}
  ]
}

**Erreurs**
- `404` (“Session introuvable”)

## 4.2 Export résultats “simples”
### GET /download_results/<session_id>

Télécharge un JSON centré sur les résultats (`history`) sans participants.

**Réponse**
- `application/json` en pièce jointe
- fichier : `poker_results_<session_id>.json`

**Structure (schéma)**
```json
{
  "sessionId": "ABC123",
  "organizer": "Alice",
  "status": "finished",
  "gameMode": "median",
  "timePerStory": 5,
  "userStories": ["..."],
  "history": [
    {"story":"...","result":5,"votes":[...]}
  ]
}

**Erreurs**
- `404` (“Session introuvable”)

## 4.3 Import : créer une nouvelle session depuis un export
### POST /resume_from_file

Crée une nouvelle session à partir d’un fichier JSON exporté.

**Form fields**
- `resume_file` *(file, requis)* : JSON exporté

**Logique exacte**
- `stories = data["userStories"]`
- `history = data["history"]`
- `completed_count = len(history)`

Si `completed_count >= len(stories)` et `len(stories) > 0` :
- `status="finished"`
- `currentStoryIndex = len(stories) - 1`

Sinon :
- `status="waiting"`
- `currentStoryIndex = completed_count`

Crée une nouvelle session Firestore avec :
- `organizer = data.get("organizer","Organisateur")`
- `history` recopiée
- `gameMode`, `round_number`, `timePerStory` recopiés (avec valeurs par défaut si absentes)

Puis :
- recrée uniquement l’organisateur comme participant (`vote=None`)
- stocke session Flask (`username`, `session_id`, `avatarSeed`)
- redirige vers `/waiting/<new_session_id>`

**Erreurs**
- si fichier absent → redirige vers `/create`
- JSON invalide → `400 "Fichier JSON invalide"`

**Réponse**
- `302 Redirect` → `/waiting/<new_session_id>`
