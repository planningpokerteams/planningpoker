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
# Clé secrète : utiliser SECRET_KEY en prod, sinon valeur de dev
app.secret_key = os.environ.get("SECRET_KEY", "une_grosse_chaine_aleatoire_que_tu_genere")

# ---------------------------------------------------------
# Chemins locaux (projet, credentials Firebase, assets SVG)
# ---------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSET_FOLDER = os.path.join(BASE_DIR, "asset")

# On accepte soit un chemin fourni par l'env, soit le fichier local (dev)
DEFAULT_SERVICE_ACCOUNT = os.path.join(
    BASE_DIR,
    "pokerplanning-749a9-firebase-adminsdk-fbsvc-10f7d5cc49.json"
)
SERVICE_ACCOUNT_FILE = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", DEFAULT_SERVICE_ACCOUNT)
SERVICE_ACCOUNT_JSON = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")

if not firebase_admin._apps:
    if SERVICE_ACCOUNT_JSON:
        # Cas Render / env : on passe directement un dict JSON (ne pas écrire sur disque)
        cred_data = json.loads(SERVICE_ACCOUNT_JSON)
        cred = credentials.Certificate(cred_data)
    else:
        # Cas local : on utilise le fichier de credentials (non versionné)
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
        organizer = request.form['organizer']
        user_stories = request.form.getlist('userStories')
        avatar_seed = request.form.get('avatar_seed', AVATAR_SEEDS[0])
        game_mode = request.form.get('game_mode', 'strict')
        time_per_story = int(request.form.get('timePerStory', 5))

        # Nouveau : fichier JSON optionnel pour reprendre une partie
        resume_file = request.files.get('resume_file')
        imported_state = None
        if resume_file and resume_file.filename:
            try:
                imported_state = json.load(resume_file.stream)
            except Exception:
                imported_state = None  # en vrai, tu pourrais afficher un message d'erreur

        session_id = generate_session_id()
        session_ref = db.collection('sessions').document(session_id)

        if imported_state:
            # On utilise ce qui vient du JSON pour préremplir la session
            data = imported_state
            session_ref.set({
                "organizer": organizer,  # le nouvel organisateur
                "status": "waiting",     # on repart toujours en attente
                "userStories": data.get("userStories", user_stories) or user_stories,
                "currentStoryIndex": data.get("currentStoryIndex", 0),
                "reveal": False,
                "final_result": None,
                "history": data.get("history", []),
                "gameMode": data.get("gameMode", game_mode),
                "round_number": data.get("round_number", 1),
                "timePerStory": data.get("timePerStory", time_per_story),
                "timerStart": None,
            })

            # Recréer les participants de l'ancienne partie
            for p in data.get("participants", []):
                session_ref.collection("participants").add({
                    "name": p.get("name"),
                    "vote": p.get("vote"),
                    "avatarSeed": p.get("avatarSeed", AVATAR_SEEDS[0]),
                    "hasVoted": p.get("hasVoted", False),
                })
        else:
            # Comportement actuel (création d'une nouvelle partie vierge)
            session_ref.set({
                "organizer": organizer,
                "status": "waiting",
                "userStories": user_stories,
                "currentStoryIndex": 0,
                "reveal": False,
                "final_result": None,
                "history": [],
                "gameMode": game_mode,
                "round_number": 1,
                "timePerStory": time_per_story,
                "timerStart": None,
            })

        # Dans tous les cas, ajouter l'organisateur comme participant
        session_ref.collection("participants").add({
            "name": organizer,
            "vote": None,
            "avatarSeed": avatar_seed,
            "hasVoted": False
        })

        session["username"] = organizer
        session["session_id"] = session_id
        session["avatarSeed"] = avatar_seed

        return redirect(url_for('waiting', session_id=session_id))

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

    # IMPORTANT : on ne change plus currentStoryIndex ici
    session_ref.update({
        "status": "started",
        "reveal": False,
        "round_number": 1,
        "timerStart": int(time.time()),
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
    # Construire la liste des participants en masquant les votes des autres
    participants_full = [p.to_dict() for p in session_ref.collection('participants').stream()]
    is_organizer = (username == data.get("organizer"))
    participants = []
    for p in participants_full:
        sanitized = {
            "name": p.get("name"),
            "avatarSeed": p.get("avatarSeed"),
            "hasVoted": p.get("hasVoted", False),
        }
        # On n'expose la valeur du vote que si les cartes sont révélées,
        # ou si l'utilisateur courant est l'organisateur, ou si c'est le joueur lui-même
        if data.get("reveal", False) or is_organizer or p.get("name") == username:
            sanitized["vote"] = p.get("vote")
        else:
            sanitized["vote"] = None
        participants.append(sanitized)

    return render_template(
        "vote.html",
        session=data,
        participants=participants,
        session_id=session_id,
        current_user=username,
        is_organizer=is_organizer,
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
    participants_full = [p.to_dict() for p in participants_snap]

    # Contexte de l'appel (qui demande l'état)
    current_user = session.get("username")
    is_current_organizer = (current_user == data.get("organizer"))

    # Votes bruts
    votes_raw = [p.get("vote") for p in participants_full]

    # all_cafe : vrai seulement si TOUT le monde a mis ☕
    all_cafe = bool(participants_full) and all(v == "☕" for v in votes_raw)

    # all_voted : vrai si personne n'a laissé la valeur à None.
    # Ici on considère que '?' et '☕' sont des actions (donc comptent comme "a voté").
    all_voted = all(v is not None for v in votes_raw)

    # Unanimité : on ignore '?' et '☕' pour décider si les votes restants sont identiques.
    non_ignored_votes = [v for v in votes_raw if v is not None and v not in ("?", "☕")]
    unanimous = False
    unanimous_value = None
    if non_ignored_votes:
        if all(x == non_ignored_votes[0] for x in non_ignored_votes):
            unanimous = True
            unanimous_value = non_ignored_votes[0]

    # Construire la liste renvoyée au front en MASQUANT les votes des autres
    participants = []
    for p in participants_full:
        sanitized = {
            "name": p.get("name"),
            "avatarSeed": p.get("avatarSeed", AVATAR_SEEDS[0]),
            "hasVoted": p.get("hasVoted", False),
        }
        # On n'expose la valeur du vote que si :
        # - les cartes sont révélées, ou
        # - l'appelant est l'organisateur, ou
        # - l'appelant est le joueur lui-même
        if data.get("reveal", False) or is_current_organizer or p.get("name") == current_user:
            sanitized["vote"] = p.get("vote")
        else:
            sanitized["vote"] = None
        participants.append(sanitized)

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
        "unanimous": unanimous,
        "unanimousValue": unanimous_value,
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

    # Si le front n'a pas envoyé de 'result', on peut le calculer ici en
    # ignorant les votes '?' et les cafés '☕' (sauf si tout le monde a mis ☕).
    if result is None:
        # Récupérer les votes bruts pour décider
        votes_raw = [v.get("vote") for v in all_votes]

        # Détecter si tout le monde a mis café
        all_cafe = bool(votes_raw) and all(v == "☕" for v in votes_raw)

        # Construire la liste de valeurs numériques à agréger en ignorant
        # '?' et '☕' (si ce n'est pas le cas où tout le monde a mis ☕)
        numeric_votes = []
        for v in votes_raw:
            if v is None:
                continue
            if v == "?":
                # Ignoré dans l'agrégation (considéré comme "nul", 0 influence)
                continue
            if v == "☕":
                # Si tout le monde a mis café, on ne peut pas calculer de valeur
                # numérique utile -> on laisse result comme None
                if all_cafe:
                    numeric_votes = []
                    break
                else:
                    # Ignorer les cafés individuels si pas unanimité
                    continue
            # Tenter de convertir en nombre
            try:
                num = float(v)
                numeric_votes.append(num)
            except Exception:
                continue

        # Calculer une moyenne si on a des votes numériques
        if numeric_votes:
            avg = sum(numeric_votes) / len(numeric_votes)
            # Arrondir à l'entier le plus proche pour rester consistant avec les cartes
            result = int(round(avg))
        else:
            # Pas de vote numérique significatif -> on garde None
            result = None

        # Mettre à jour l'historique dernier élément avec le résultat calculé
        history[-1]["result"] = result

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
# CHAT API : stocke et lit les messages de chat pour une session
# ---------------------------------------------------------
@app.route('/api/chat/<session_id>', methods=['GET', 'POST'])
def api_chat(session_id):
    session_ref = db.collection('sessions').document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return jsonify({"error": "not_found"}), 404

    # POST -> ajouter un message
    if request.method == 'POST':
        username = session.get('username')
        if not username:
            return jsonify({"error": "not_authenticated"}), 401

        data = request.get_json(silent=True) or {}
        text = data.get('text', '').strip()
        if not text:
            return jsonify({"error": "empty"}), 400

        chat_ref = session_ref.collection('chat')
        chat_ref.add({
            'sender': username,
            'text': text,
            'ts': int(time.time())
        })
        return jsonify({"status": "ok"}), 201

    # GET -> renvoyer les derniers messages (limit 200)
    msgs = []
    for doc in session_ref.collection('chat').order_by('ts').limit(200).stream():
        d = doc.to_dict()
        msgs.append({
            'sender': d.get('sender'),
            'text': d.get('text'),
            'ts': d.get('ts')
        })

    return jsonify({"messages": msgs})

# ---------------------------------------------------------
# DOWNLOAD RESULTS : export JSON complet de la session
# ---------------------------------------------------------
@app.route('/export_state/<session_id>')
def export_state(session_id):
    session_ref = db.collection("sessions").document(session_id)
    snapshot = session_ref.get()
    if not snapshot.exists:
        return "Session introuvable", 404

    data = snapshot.to_dict() or {}

    # Récupérer les participants actuels
    participants_snap = list(session_ref.collection("participants").stream())
    participants = [p.to_dict() for p in participants_snap]

    export = {
        "schemaVersion": 1,
        "sessionId": session_id,
        "organizer": data.get("organizer"),
        "status": data.get("status"),
        "gameMode": data.get("gameMode"),
        "timePerStory": data.get("timePerStory"),
        "userStories": data.get("userStories", []),
        "currentStoryIndex": data.get("currentStoryIndex", 0),
        "round_number": data.get("round_number", 1),
        "history": data.get("history", []),
        "participants": participants,
    }

    json_str = json.dumps(export, ensure_ascii=False, indent=2)
    filename = f"poker_state_{session_id}.json"

    return Response(
        json_str,
        mimetype="application/json",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        },
    )

@app.route('/download_results/<session_id>')
def download_results(session_id):
    """Exporter les résultats finaux de la session (format plus simple)."""
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
        "history": data.get("history", []),
    }

    json_str = json.dumps(export, ensure_ascii=False, indent=2)
    filename = f"poker_results_{session_id}.json"

    return Response(
        json_str,
        mimetype="application/json",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        },
    )

@app.route('/resume_from_file', methods=['POST'])
def resume_from_file():
    resume_file = request.files.get('resume_file')
    if not resume_file or not resume_file.filename:
        return redirect(url_for('create'))

    try:
        imported_state = json.load(resume_file.stream)
    except Exception:
        return "Fichier JSON invalide", 400

    data = imported_state or {}
    stories = data.get("userStories", [])
    history = data.get("history", [])

    # Nombre de stories déjà jouées
    completed_count = len(history)

    # Calcul du nouvel index de story
    if completed_count >= len(stories):
        # Toutes les stories ont déjà été jouées -> partie finie
        new_status = "finished"
        new_index = max(0, len(stories) - 1)
    else:
        # On reprend sur la première story non encore dans l'historique
        new_status = "waiting"
        new_index = completed_count

    session_id = generate_session_id()
    session_ref = db.collection('sessions').document(session_id)

    organizer = data.get("organizer", "Organisateur")

    # Avatar de l'organisateur (si présent dans les anciens participants)
    avatar_seed = AVATAR_SEEDS[0]
    for p in data.get("participants", []):
        if p.get("name") == organizer:
            avatar_seed = p.get("avatarSeed", AVATAR_SEEDS[0])
            break

    session_ref.set({
        "organizer": organizer,
        "status": new_status,
        "userStories": stories,
        "currentStoryIndex": new_index,
        "reveal": False,
        "final_result": None,
        "history": history,             # on garde l'historique pour la colonne de gauche
        "gameMode": data.get("gameMode", "strict"),
        "round_number": data.get("round_number", 1),
        "timePerStory": data.get("timePerStory", 5),
        "timerStart": None,
    })

    # On NE recrée que l'organisateur comme participant actif
    session_ref.collection("participants").add({
        "name": organizer,
        "vote": None,
        "avatarSeed": avatar_seed,
        "hasVoted": False,
    })

    session["username"] = organizer
    session["session_id"] = session_id
    session["avatarSeed"] = avatar_seed

    return redirect(url_for('waiting', session_id=session_id))

    """Créer une nouvelle session à partir d'un fichier JSON exporté."""
    resume_file = request.files.get('resume_file')
    if not resume_file or not resume_file.filename:
        return redirect(url_for('create'))

    try:
        imported_state = json.load(resume_file.stream)
    except Exception:
        return "Fichier JSON invalide", 400

    data = imported_state or {}

    session_id = generate_session_id()
    session_ref = db.collection('sessions').document(session_id)

    # On récupère l'organisateur d'origine
    organizer = data.get("organizer", "Organisateur")

    # On essaie de retrouver son avatar dans la liste des anciens participants
    avatar_seed = AVATAR_SEEDS[0]
    for p in data.get("participants", []):
        if p.get("name") == organizer:
            avatar_seed = p.get("avatarSeed", AVATAR_SEEDS[0])
            break

    # Création de la nouvelle session à partir de l'état importé
    session_ref.set({
        "organizer": organizer,
        "status": "waiting",  # on repart en salle d'attente
        "userStories": data.get("userStories", []),
        "currentStoryIndex": data.get("currentStoryIndex", 0),
        "reveal": False,
        "final_result": None,
        "history": data.get("history", []),  # conserve les votes passés
        "gameMode": data.get("gameMode", "strict"),
        "round_number": data.get("round_number", 1),
        "timePerStory": data.get("timePerStory", 5),
        "timerStart": None,
    })

    # IMPORTANT : on ne recrée QUE l'organisateur comme participant actif
    session_ref.collection("participants").add({
        "name": organizer,
        "vote": None,
        "avatarSeed": avatar_seed,
        "hasVoted": False,
    })

    # On connecte l'organisateur à cette nouvelle session
    session["username"] = organizer
    session["session_id"] = session_id
    session["avatarSeed"] = avatar_seed

    # Direction la salle d'attente directement
    return redirect(url_for('waiting', session_id=session_id))

# ---------------------------------------------------------
# Point d’entrée de l’application Flask (mode debug dev)
# ---------------------------------------------------------
if __name__ == '__main__':
    app.run(debug=True)
