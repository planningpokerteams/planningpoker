# Planning Poker – Application d’estimation agile

Application web de Planning Poker permettant à une équipe de faire des estimations d’user stories en temps réel.  
Le backend est développé avec Flask et Firestore, et le frontend en HTML / CSS / JavaScript.

---

## Fonctionnalités principales

- Création d’une partie avec un organisateur et une liste d’user stories.  
- Rejoindre une partie via un code de session.  
- Salle d’attente affichant les participants connectés.  
- Écran de vote avec deck Planning Poker (1, 2, 3, 5, 8, 13, café, ?).  
- Reveal des cartes, gestion des tours (revote, story suivante, fin de partie).  
- Export JSON de l’état de la partie et des résultats finaux.  

---

## Architecture du projet

planningpoker-main/
├─ app.py # Backend Flask + routes et logique métier
├─ start.sh # Script de lancement de l’application
├─ requirements.txt # Dépendances Python 
├─ package.json # Config JS / tests front (Jest)
├─ package-lock.json # Verrouillage des dépendances npm
├─ README.md # Documentation du projet
├─ asset/ # Cartes SVG 
├─ templates/ # Pages HTML (Jinja)
│ ├─ index.html # Page d'accueil
│ ├─ create.html # Création d'une partie
│ ├─ join.html # Rejoindre une partie
│ ├─ waiting.html # Salle d'attente
│ └─ vote.html # Écran de vote
├─ static/ # JS / CSS côté client
│ ├─ create.js
│ ├─ waiting.js
│ ├─ vote.js
│ ├─ vote-utils.js
│ └─ style.css 
├─ tests/
│ ├─ backend/ # Tests Pytest du backend Flask
│ │ └─ test_app.py 
│ └─ frontend/ # Tests Jest du frontend
│ ├─ create.test.js
│ ├─ waiting.test.js
│ ├─ vote-dom.test.js
│ └─ vote-utils.test.js
└─ .git/ # Métadonnées Git 

---

## Prérequis

- Python 3.x installé.  
- Accès à un projet Firebase / Firestore configuré (fichier de credentials référencé dans `app.py`).  
- Optionnel : Node.js pour lancer ou modifier les tests front (Jest) définis dans `package.json` et `package-lock.json`.

---

## Installation

1. Cloner le dépôt :

git clone https://github.com/planningpokerteams/planningpoker.git
cd planningpoker-main

---

## Lancement du projet

Pour démarrer l'application, utilise simplement le script `start.sh` à la racine du projet :
./start.sh

Ce script se charge de préparer l'environnement puis lance l'application Flask définie dans `app.py` en mode développement.

---

## Tests

### Tests backend (Python)

Depuis la racine du projet, avec l’environnement virtuel activé :
python -m pytest tests/backend/test_app.py


Les tests vérifient notamment :

- La création et la jonction de sessions.  
- Le démarrage de partie, le reveal, le passage à la story suivante, la fin de partie, etc.  
- Les exports JSON (`/download_results`, `/export_state`) et la reprise de partie via un fichier JSON (`/resume_from_file`).

### Tests frontend (JavaScript)

Si Node.js et npm sont installés :

npm install
npm test


Cela lance les tests Jest définis dans `tests/frontend` pour le comportement du code JavaScript (DOM, utilitaires, etc.).

---

## Licence

Projet réalisé à des fins pédagogiques.