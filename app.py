from flask import (
    Flask, render_template, request, redirect,
    url_for, session, jsonify, send_from_directory, Response
)
import os
import random
import string
import time
import json

import firebase_admin
from firebase_admin import credentials, firestore

# ---------------------------------------------------------
# Initialisation Flask
# ---------------------------------------------------------
app = Flask(__name__)
# Clé secrète pour la session côté serveur (à remplacer en prod)
app.secret_key = "une_grosse_chaine_aleatoire_que_tu_genere"

# ---------------------------------------------------------
# Chemins locaux (projet, credentials Firebase, assets SVG)
# ---------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_ACCOUNT_FILE = os.path.join(
    BASE_DIR,
    "pokerplanning-749a9-firebase-adminsdk-fbsvc-10f7d5cc49.json"
)
ASSET_FOLDER = os.path.join(BASE_DIR, "asset")

# ---------------------------------------------------------
# Initialisation Firebase / Firestore
# ---------------------------------------------------------
if not firebase_admin._apps:
    cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# ---------------------------------------------------------
# Données statiques pour les avatars et le deck de cartes
# ---------------------------------------------------------
AVATAR_SEEDS = [
    "astronaut", "ninja", "pirate", "wizard",
    "gamer", "robot", "detective", "viking"
]

# Deck utilisé pour le poker planning (inclut café et ?)
CARDS = [
    {"value": 1, "file": "cartes_1.svg"},
    {"value": 2, "file": "cartes_2.svg"},
    {"value": 3, "file": "cartes_3.svg"},
    {"value": 5, "file": "cartes_5.svg"},
    {"value": 8, "file": "cartes_8.svg"},
    {"value": 13, "file": "cartes_13.svg"},
    {"value": "☕", "file": "cartes_cafe.svg"},
    {"value": "?", "file": "cartes_interro.svg"},
]

# ---------------------------------------------------------
# Utilitaire : génération d’un code de session aléatoire
# ---------------------------------------------------------
def generate_session_id():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

# ---------------------------------------------------------
# Route de service : servir les fichiers d’assets (cartes SVG)
# ---------------------------------------------------------
@app.route("/asset/<path:filename>")
def asset_file(filename):
    return send_from_directory(ASSET_FOLDER, filename)

# ---------------------------------------------------------
# Page d’accueil (landing / choix créer ou rejoindre)
# ---------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')

# ---------------------------------------------------------
# CREATE SESSION : création d’une nouvelle partie
# ---------------------------------------------------------
@app.route('/create', methods=['GET', 'POST'])
def create():
    if request.method == 'POST':
        # Récupération des champs du formulaire de création
        organizer = request.form['organizer']
        user_stories = request.form.getlist('userStories')
        avatar_seed = request.form.get('avatar_seed', AVATAR_SEEDS[0])
        game_mode = request.form.get('game_mode', 'strict')
        time_per_story = int(request.form.get('timePerStory', 5))

        # Création d’un nouvel identifiant de session
        session_id = generate_session_id()
        session_ref = db.collection('sessions').document(session_id)

        # État initial de la session dans Firestore
        session_ref.set({
            "organizer": organizer,
            "status": "waiting",              # salle d’attente
            "userStories": user_stories,
            "currentStoryIndex": 0,
            "reveal": False,
            "final_result": None,
            "history": [],                    # historique des stories jouées
            "gameMode": game_mode,            # strict / average / median / abs / rel
            "round_number": 1,
            "timePerStory": time_per_story,   # minutes
            "timerStart": None                # timestamp de départ par story
        })

        # Ajout de l’organisateur comme premier participant
        session_ref.collection("participants").add({
            "name": organizer,
            "vote": None,
            "avatarSeed": avatar_seed,
            "hasVoted": False
        })

        # Mémorisation côté session Flask (pour lier navigateur ↔ session Firestore)
        session["username"] = organizer
        session["session_id"] = session_id
        session["avatarSeed"] = avatar_seed

        # Redirection vers la salle d’attente de la nouvelle session
        return redirect(url_for('waiting', session_id=session_id))

    # GET : affichage du formulaire de création
    return render_template("create.html", avatars=AVATAR_SEEDS)

# ---------------------------------------------------------
# JOIN : rejoindre une session existante avec un code
# ---------------------------------------------------------
@app.route('/join', methods=['GET', 'POST'])
def join():
    if request.method == 'POST':
        code = request.form['code']
        name = request.form['name']
        avatar_seed = request.form.get('avatar_seed', AVATAR_SEEDS[0])

        # Vérifie que la session existe
        session_ref = db.collection("sessions").document(code)
        if not session_ref.get().exists:
            return "Code invalide."

        # Ajoute le participant à la collection participants
        session_ref.collection("participants").add({
            "name": name,
            "vote": None,
            "avatarSeed": avatar_seed,
            "hasVoted": False
        })

        # Sauvegarde de l’identité dans la session Flask
        session["username"] = name
        session["session_id"] = code
        session["avatarSeed"] = avatar_seed

        # Redirection vers la salle d’attente
        return redirect(url_for("waiting", session_id=code))

    # GET : formulaire pour rejoindre une session
    return render_template("join.html", avatars=AVATAR_SEEDS)

# ---------------------------------------------------------
# SALLE D’ATTENTE : affichage des joueurs connectés
# ---------------------------------------------------------
@app.route('/waiting/<session_id>')
def waiting(session_id):
    session_ref = db.collection('sessions').document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return "Session introuvable", 404

    session_data = snapshot.to_dict()
    participants = [p.to_dict()
                    for p in session_ref.collection('participants').stream()]

    return render_template(
        "waiting.html",
        session_id=session_id,
        session=session_data,
        participants=participants,
        current_user=session.get("username")
    )

# API utilisée par la waiting room pour rafraîchir la liste des joueurs
@app.route('/api/participants/<session_id>')
def api_participants(session_id):
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return jsonify({"error": "session_not_found"}), 404

    session_data = snapshot.to_dict()
    participants = [p.to_dict()
                    for p in session_ref.collection("participants").stream()]

    return jsonify({
        "participants": participants,
        "status": session_data.get("status", "waiting")
    })

# ---------------------------------------------------------
# START GAME : l’organisateur lance la partie
# ---------------------------------------------------------
@app.route('/start/<session_id>', methods=['POST'])
def start(session_id):
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return "Session introuvable", 404

    username = session.get("username")
    session_data = snapshot.to_dict()

    # Sécurité : seul l’organisateur peut démarrer
    if username != session_data.get("organizer"):
        return "Non autorisé"

    # Reset des votes avant de commencer
    for p in session_ref.collection("participants").stream():
        p.reference.update({"vote": None, "hasVoted": False})

    # Mise à jour de l’état de la partie
    session_ref.update({
        "status": "started",
        "currentStoryIndex": 0,
        "reveal": False,
        "round_number": 1,
        "timerStart": int(time.time())
    })

    return redirect(url_for("vote", session_id=session_id))

# ---------------------------------------------------------
# VOTE PAGE : écran principal de vote (tous les joueurs)
# ---------------------------------------------------------
@app.route('/vote/<session_id>', methods=['GET', 'POST'])
def vote(session_id):
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return "Session introuvable", 404

    data = snapshot.to_dict()

    # Si on n’a pas d’utilisateur en session, on renvoie vers /join
    if "username" not in session:
        return redirect(url_for("join"))

    username = session["username"]

    # Lorsqu’un joueur envoie un vote
    if request.method == "POST":
        vote_val = request.form["vote"]
        for p in session_ref.collection("participants").stream():
            if p.to_dict().get("name") == username:
                p.reference.update({
                    "vote": vote_val,
                    "hasVoted": True
                })
                break
        return redirect(url_for("vote", session_id=session_id))

    # GET : affichage de la table de vote
    participants = [p.to_dict()
                    for p in session_ref.collection('participants').stream()]

    return render_template(
        "vote.html",
        session=data,
        participants=participants,
        session_id=session_id,
        current_user=username,
        is_organizer=(username == data.get("organizer")),
        cards=CARDS
    )

# ---------------------------------------------------------
# REVEAL : l’organisateur révèle les cartes
# ---------------------------------------------------------
@app.route('/reveal/<session_id>', methods=['POST'])
def reveal(session_id):
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return "Session introuvable", 404

    data = snapshot.to_dict()
    username = session.get("username")
    if username != data.get("organizer"):
        return "Non autorisé"

    if data.get("status") == "finished":
        return "Partie terminée", 400

    # Flag Firestore permettant au front d’afficher les cartes
    session_ref.update({"reveal": True})
    return redirect(url_for("vote", session_id=session_id))

# ---------------------------------------------------------
# API GAME STATE : état temps réel de la partie
# ---------------------------------------------------------
@app.route('/api/game/<session_id>')
def api_game(session_id):
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return jsonify({"error": "not_found"}), 404

    data = snapshot.to_dict() or {}
    stories = data.get("userStories", [])
    idx = data.get("currentStoryIndex", 0)
    current_story = stories[idx] if 0 <= idx < len(stories) else ""

    participants_snap = list(session_ref.collection("participants").stream())
    participants = [p.to_dict() for p in participants_snap]

    # all_voted : tout le monde a déposé un vote (hors café / ?)
    all_voted = True
    # all_cafe : tout le monde a explicitement joué ☕
    all_cafe  = bool(participants)
    for p in participants:
        if p.get("vote") is None:
            all_voted = False
        if p.get("vote") != "☕":
            all_cafe = False

    # Gestion de la pause café : si tout le monde est sur ☕
    if all_cafe and data.get("status") not in ("finished", "paused"):
        time_per_story = data.get("timePerStory", 5)
        timer_start    = data.get("timerStart")
        pause_remaining = None

        # Calcul du temps restant au moment de la pause
        if timer_start is not None:
            now     = int(time.time())
            elapsed = now - int(timer_start)
            total   = time_per_story * 60
            pause_remaining = max(0, total - elapsed)

        # On arrête le chrono et on mémorise les secondes restantes
        session_ref.update({
            "status": "paused",
            "timerStart": None,
            "pauseRemaining": pause_remaining
        })
        data["status"]         = "paused"
        data["timerStart"]     = None
        data["pauseRemaining"] = pause_remaining

    # Structure renvoyée au front (vote.js) pour l’UI temps réel
    return jsonify({
        "participants": participants,
        "allVoted": all_voted,
        "allCafe": all_cafe,
        "reveal": data.get("reveal", False),
        "currentStory": current_story,
        "history": data.get("history", []),
        "gameMode": data.get("gameMode", "strict"),
        "roundNumber": data.get("round_number", 1),
        "timePerStory": data.get("timePerStory", 5),
        "timerStart": data.get("timerStart"),
        "status": data.get("status", "waiting")
        # "pauseRemaining": data.get("pauseRemaining")  # exposable si besoin
    })

# ---------------------------------------------------------
# RESUME : reprise après une pause café
# ---------------------------------------------------------
@app.route('/resume/<session_id>', methods=['POST'])
def resume(session_id):
    """Reprendre une partie en pause café en gardant le temps restant."""
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return jsonify({"error": "not_found"}), 404

    data = snapshot.to_dict() or {}
    if data.get("status") != "paused":
        return jsonify({"status": "ignored"}), 200

    time_per_story  = data.get("timePerStory", 5)
    pause_remaining = data.get("pauseRemaining")  # secondes restantes
    now = int(time.time())

    # Si aucun temps restant stocké, on repart sur un timer complet
    if pause_remaining is None or pause_remaining <= 0:
        new_timer_start = now
    else:
        total_seconds   = time_per_story * 60
        # On choisit new_timer_start pour que :
        # remaining = total_seconds - (now - new_timer_start) = pause_remaining
        new_timer_start = now - (total_seconds - int(pause_remaining))

    # Nettoyage des votes ☕ pour relancer un nouveau tour sur la même story
    for p in session_ref.collection("participants").stream():
        p.reference.update({"vote": None, "hasVoted": False})

    # Reprise de la partie avec le chrono recalibré
    session_ref.update({
        "status": "started",
        "timerStart": new_timer_start,
        "pauseRemaining": None
    })
    return jsonify({"status": "ok"})

# ---------------------------------------------------------
# NEXT STORY : passage à la user story suivante
# ---------------------------------------------------------
@app.route('/next_story/<session_id>', methods=['POST'])
def next_story(session_id):
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return jsonify({"error": "not_found"}), 404

    data = snapshot.to_dict() or {}
    if data.get("status") == "finished":
        return jsonify({"error": "game_finished"}), 400

    stories = data.get("userStories", [])
    idx = data.get("currentStoryIndex", 0)
    history = data.get("history", [])

    # Résultat global envoyé par le front (mode strict / moyenne / etc.)
    req_data = request.get_json(silent=True) or {}
    result = req_data.get("result")

    # Construction de l’historique détaillé avec tous les votes
    all_votes = []
    for p in session_ref.collection("participants").stream():
        user = p.to_dict()
        all_votes.append({
            "name": user.get("name"),
            "avatar": user.get("avatarSeed", "astronaut"),
            "vote": user.get("vote")
        })

    story_text = stories[idx] if 0 <= idx < len(stories) else ""

    history.append({
        "story": story_text,
        "result": result,
        "votes": all_votes
    })

    update_payload = {
        "history": history
    }

    # Reset des votes pour la prochaine story (ou fin de partie)
    for p in session_ref.collection('participants').stream():
        p.reference.update({"vote": None, "hasVoted": False})

    # Cas 1 : il reste des stories -> on avance l’index
    if idx < len(stories) - 1:
        idx += 1
        update_payload.update({
            "currentStoryIndex": idx,
            "reveal": False,
            "final_result": None,
            "round_number": 1,
            "timerStart": int(time.time()),
            "status": "started"
        })
    else:
        # Cas 2 : dernière story -> on termine la partie
        update_payload.update({
            "status": "finished",
            "reveal": True,
            "final_result": result,
            "timerStart": None
        })

    session_ref.update(update_payload)
    return jsonify({"status": "ok"})

# ---------------------------------------------------------
# REVOTE : même story, nouveau tour d’estimation
# ---------------------------------------------------------
@app.route('/revote/<session_id>', methods=['POST'])
def revote(session_id):
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return jsonify({"error": "not_found"}), 404

    data = snapshot.to_dict() or {}
    if data.get("status") == "finished":
        return jsonify({"error": "game_finished"}), 400

    current_round = data.get("round_number", 1)

    # Reset des votes, mais on ne touche pas au timer pour garder
    # la même contrainte de temps sur les tours suivants
    for p in session_ref.collection("participants").stream():
        p.reference.update({"vote": None, "hasVoted": False})

    session_ref.update({
        "reveal": False,
        "final_result": None,
        "round_number": current_round + 1
    })

    return jsonify({"status": "ok"})

# ---------------------------------------------------------
# DOWNLOAD RESULTS : export JSON complet de la session
# ---------------------------------------------------------
@app.route('/download_results/<session_id>')
def download_results(session_id):
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return "Session introuvable", 404

    data = snapshot.to_dict() or {}
    export = {
        "sessionId": session_id,
        "organizer": data.get("organizer"),
        "status": data.get("status"),
        "gameMode": data.get("gameMode"),
        "timePerStory": data.get("timePerStory"),
        "userStories": data.get("userStories", []),
        "history": data.get("history", [])
    }

    json_str = json.dumps(export, ensure_ascii=False, indent=2)
    filename = f"poker_results_{session_id}.json"

    # Réponse HTTP permettant le téléchargement du fichier JSON
    return Response(
        json_str,
        mimetype="application/json",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )

# ---------------------------------------------------------
# Point d’entrée de l’application Flask (mode debug dev)
# ---------------------------------------------------------
if __name__ == '__main__':
    app.run(debug=True)
