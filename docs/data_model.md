# Modèle de données – Planning Poker

Ce document décrit le **modèle de données backend** utilisé par l’application *Planning Poker*.
Les données sont stockées dans **Google Firestore** et organisées autour d’une collection principale `sessions`
et de sous-collections associées.

---

## 1) Vue d’ensemble

Le modèle repose sur une entité centrale :

- **Session de Planning Poker**
  - identifiée par un `session_id`
  - contenant l’état global du jeu
  - liée à des sous-collections :
    - participants
    - messages de chat

Chaque session correspond à **une partie complète**, de la création jusqu’à la fin.

---

## 2) Collection principale : `sessions`

### Chemin
sessions/{session_id}

### Description
Un document de la collection `sessions` représente **une partie de Planning Poker**.

---

### 2.1 Champs du document `session`

| Champ | Type | Description |
|------|------|-------------|
| organizer | string | Pseudo de l’organisateur de la partie |
| status | string | État de la partie : waiting, started, paused, finished |
| userStories | list[string] | Liste ordonnée des user stories à estimer |
| currentStoryIndex | int | Index de la story courante |
| reveal | bool | Indique si les votes sont révélés |
| final_result | any / null | Résultat final de la story |
| history | list[object] | Historique des stories terminées |
| gameMode | string | Mode de jeu (strict, median, etc.) |
| round_number | int | Numéro du tour courant |
| timePerStory | int | Temps par story (en minutes) |
| timerStart | int / null | Timestamp UNIX du début du timer |

---

### 2.2 Exemple de document `session`

{
  "organizer": "Alice",
  "status": "started",
  "userStories": [
    "US-01 : Authentification",
    "US-02 : Dashboard"
  ],
  "currentStoryIndex": 0,
  "reveal": false,
  "final_result": null,
  "gameMode": "strict",
  "round_number": 1,
  "timePerStory": 5,
  "timerStart": 1730000000,
  "history": []
}

---

## 3) Sous-collection : `participants`

### Chemin
sessions/{session_id}/participants/{participant_id}

### Description
Chaque document représente **un participant** à la partie.
Le champ `name` est utilisé comme identifiant logique côté application.

---

### 3.1 Champs d’un participant

| Champ | Type | Description |
|------|------|-------------|
| name | string | Pseudo du participant |
| vote | string / null | Vote (1, 5, 8, ?, ☕, etc.) |
| avatarSeed | string | Seed de génération d’avatar |
| hasVoted | bool | Indique si le participant a voté |

---

### 3.2 Exemple de participant

{
  "name": "Bob",
  "vote": "8",
  "avatarSeed": "ninja",
  "hasVoted": true
}

---

## 4) Sous-collection : `chat`

### Chemin
sessions/{session_id}/chat/{message_id}

### Description
Stocke les **messages de chat** échangés pendant la partie.

---

### 4.1 Champs d’un message

| Champ | Type | Description |
|------|------|-------------|
| sender | string | Pseudo de l’expéditeur |
| text | string | Contenu du message |
| ts | int | Timestamp UNIX (secondes) |

---

### 4.2 Exemple de message

{
  "sender": "Alice",
  "text": "On commence ?",
  "ts": 1730000123
}

---

## 5) Historique des stories (`history`)

Le champ `history` conserve les **résultats des stories déjà traitées**.

---

### 5.1 Structure d’un élément `history`

| Champ | Type | Description |
|------|------|-------------|
| story | string | Texte de la user story |
| result | any | Résultat final |
| votes | list[object] | Votes détaillés des participants |

---

### 5.2 Exemple d’entrée `history`

{
  "story": "US-01 : Authentification",
  "result": 5,
  "votes": [
    {
      "name": "Alice",
      "avatarSeed": "astronaut",
      "vote": "5"
    },
    {
      "name": "Bob",
      "avatarSeed": "ninja",
      "vote": "8"
    }
  ]
}

---

## 6) Contraintes et règles métier

- Une session possède **un seul organisateur**
- Les votes sont **réinitialisés** à chaque tour ou revote
- Les votes spéciaux ("?", "☕") sont exclus des calculs statistiques
- Le champ `history` est **append-only**
- Les sous-collections sont supprimées lorsque la session est supprimée

---

## 7) Remarques d’implémentation

- Firestore est utilisé sans schéma strict, ce document sert de **référence contractuelle**
- Les timestamps sont stockés en **secondes UNIX**
- Le modèle est volontairement **simple et orienté temps réel**
