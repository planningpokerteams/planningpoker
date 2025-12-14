"""
@file app.py
@brief Backend Flask de Planning Poker (sessions, votes, chat, export/import).
@details
- Pages HTML: /, /create, /join, /waiting/<id>, /vote/<id>
- API JSON: /api/game/<id>, /api/participants/<id>, /api/chat/<id>, ...
- Persistance: Firestore (sessions + sous-collections participants/chat)
"""


from flask import (
    Flask, render_template, request, redirect,
    url_for, session, jsonify, send_from_directory, Response
)

import os
import random
import string
import time
import json
from typing import Any, Dict, List, Optional, Tuple

import firebase_admin
from firebase_admin import credentials, firestore


# =========================================================
# 1) Initialisation Flask
# =========================================================
app = Flask(__name__)

# IMPORTANT :
# - En prod, mets SECRET_KEY dans les variables d'env.
# - En dev, fallback acceptable.
app.secret_key = os.environ.get(
    "SECRET_KEY",
    "dev_only_change_me_to_a_real_secret_key"
)

# Optionnel mais recommandé (sécurité cookies de session)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)


# =========================================================
# 2) Chemins locaux (projet, credentials Firebase, assets SVG)
# =========================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSET_FOLDER = os.path.join(BASE_DIR, "asset")

DEFAULT_SERVICE_ACCOUNT = os.path.join(
    BASE_DIR,
    "pokerplanning-749a9-firebase-adminsdk-fbsvc-10f7d5cc49.json"
)

# 3 modes possibles (dans l'ordre de priorité ci-dessous) :
# 1) Render secret file : /etc/secrets/firebase-key.json
# 2) Env var GOOGLE_APPLICATION_CREDENTIALS_JSON (json string OU chemin fichier)
# 3) Env var GOOGLE_APPLICATION_CREDENTIALS (chemin fichier) sinon local dev
SERVICE_ACCOUNT_FILE = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", DEFAULT_SERVICE_ACCOUNT)
SERVICE_ACCOUNT_JSON = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
RENDER_SECRET_FILE = "/etc/secrets/firebase-key.json"


# =========================================================
# 3) Initialisation Firebase Admin + Firestore
# =========================================================
def _init_firebase() -> None:
    """
    Initialise Firebase Admin une seule fois.
    Supporte Render secret files + env json + fichier local.
    """
    if firebase_admin._apps:
        return

    cred_obj = None

    # (1) Render secret file
    if os.path.exists(RENDER_SECRET_FILE):
        try:
            with open(RENDER_SECRET_FILE, "r", encoding="utf-8") as f:
                cred_data = json.load(f)
            cred_obj = credentials.Certificate(cred_data)
        except Exception:
            cred_obj = None

    # (2) Env JSON (json string ou chemin)
    if cred_obj is None and SERVICE_ACCOUNT_JSON:
        try:
            cred_data = json.loads(SERVICE_ACCOUNT_JSON)
            cred_obj = credentials.Certificate(cred_data)
        except Exception:
            # Si ce n'est pas du JSON, on tente comme un path
            if os.path.exists(SERVICE_ACCOUNT_JSON):
                cred_obj = credentials.Certificate(SERVICE_ACCOUNT_JSON)

    # (3) Local / path
    if cred_obj is None:
        cred_obj = credentials.Certificate(SERVICE_ACCOUNT_FILE)

    firebase_admin.initialize_app(cred_obj)


_init_firebase()
db = firestore.client()


# =========================================================
# 4) Données statiques : avatars + cartes
# =========================================================
AVATAR_SEEDS = [
    "astronaut", "ninja", "pirate", "wizard",
    "gamer", "robot", "detective", "viking"
]

# Deck planning poker (inclut café et ?)
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


# =========================================================
# 5) Helpers / utilitaires
# =========================================================
def generate_session_id() -> str:
    """Génère un code de session (6 chars) : A-Z0-9."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


def _session_ref(session_id: str):
    """Raccourci Firestore : doc ref d'une session."""
    return db.collection("sessions").document(session_id)


def _get_session_or_404(session_id: str) -> Tuple[Any, Dict[str, Any]]:
    """
    Récupère session snapshot + dict.
    Lève une réponse 404 (via tuple) si introuvable.
    """
    ref = _session_ref(session_id)
    snap = ref.get()
    if not snap.exists:
        # on renvoie une "pseudo réponse" gérée par l'appelant
        return ref, {}
    return ref, (snap.to_dict() or {})


def _require_user() -> Optional[str]:
    """Retourne le username en session Flask, ou None."""
    return session.get("username")


def _safe_int(value: Any, default: int, min_value: Optional[int] = None) -> int:
    """Convertit en int (fallback default) + clamp min si fourni."""
    try:
        v = int(value)
    except Exception:
        v = default
    if min_value is not None and v < min_value:
        v = min_value
    return v


def _participants_list(session_ref) -> List[Dict[str, Any]]:
    """Liste brute des participants."""
    return [p.to_dict() for p in session_ref.collection("participants").stream()]


def _update_participant_by_name(session_ref, name: str, patch: Dict[str, Any]) -> bool:
    """
    Met à jour le 1er participant trouvé avec `name`.
    (Optimisation : au lieu de parcourir tous les docs.)
    Retourne True si update, False sinon.
    """
    q = session_ref.collection("participants").where("name", "==", name).limit(1).stream()
    doc = next(q, None)
    if not doc:
        return False
    doc.reference.update(patch)
    return True


def _reset_all_votes(session_ref) -> None:
    """
    Reset vote/hasVoted pour tous les participants.
    (Pour gros volumes : on pourra passer en batch, mais ici ça suffit.)
    """
    for p in session_ref.collection("participants").stream():
        p.reference.update({"vote": None, "hasVoted": False})


# =========================================================
# 6) Assets : servir les fichiers (cartes SVG)
# =========================================================
@app.route("/asset/<path:filename>")
def asset_file(filename):
    """
    @brief Route `asset_file`.
    @route /asset/<path:filename>
    """
    return send_from_directory(ASSET_FOLDER, filename)


# =========================================================
# 7) Pages
# =========================================================
@app.route("/")
def index():
    """
    @brief Route `index`.
    @route /
    """
    return render_template("index.html")


# =========================================================
# 8) CREATE : création d’une nouvelle partie
# =========================================================
@app.route("/create", methods=["GET", "POST"])
def create():
    """
    @brief Route `create`.
    @route /create
    @methods GET, POST
    """
    if request.method == "POST":
        organizer = (request.form.get("organizer") or "").strip()
        user_stories = request.form.getlist("userStories")
        avatar_seed = request.form.get("avatar_seed", AVATAR_SEEDS[0])
        game_mode = request.form.get("game_mode", "strict")
        time_per_story = _safe_int(request.form.get("timePerStory", 5), default=5, min_value=1)

        if not organizer:
            return "Pseudo organisateur requis.", 400

        # Import JSON optionnel (reprendre une partie)
        resume_file = request.files.get("resume_file")
        imported_state = None
        if resume_file and resume_file.filename:
            try:
                imported_state = json.load(resume_file.stream)
            except Exception:
                imported_state = None  # tu peux remplacer par un flash message si tu veux

        # Générer un code unique (simple retry si collision)
        session_id = generate_session_id()
        session_ref = _session_ref(session_id)
        while session_ref.get().exists:
            session_id = generate_session_id()
            session_ref = _session_ref(session_id)

        # ---------- Création session Firestore ----------
        if imported_state:
            data = imported_state or {}

            session_ref.set({
                "organizer": organizer,  # nouvel organisateur
                "status": "waiting",
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

            # Recréer les participants de l'ancienne partie (optionnel)
            for p in data.get("participants", []):
                session_ref.collection("participants").add({
                    "name": p.get("name"),
                    "vote": p.get("vote"),
                    "avatarSeed": p.get("avatarSeed", AVATAR_SEEDS[0]),
                    "hasVoted": p.get("hasVoted", False),
                })
        else:
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

        # Ajouter l'organisateur comme participant (même si import)
        session_ref.collection("participants").add({
            "name": organizer,
            "vote": None,
            "avatarSeed": avatar_seed,
            "hasVoted": False
        })

        # Sauvegarde côté session Flask
        session["username"] = organizer
        session["session_id"] = session_id
        session["avatarSeed"] = avatar_seed

        return redirect(url_for("waiting", session_id=session_id))

    return render_template("create.html", avatars=AVATAR_SEEDS)


# =========================================================
# 9) JOIN : rejoindre une session existante
# =========================================================
@app.route("/join", methods=["GET", "POST"])
def join():
    """
    @brief Route `join`.
    @route /join
    @methods GET, POST
    """
    if request.method == "POST":
        code = (request.form.get("code") or "").strip().upper()
        name = (request.form.get("name") or "").strip()
        avatar_seed = request.form.get("avatar_seed", AVATAR_SEEDS[0])

        if not code or not name:
            return "Code et pseudo requis.", 400

        session_ref, data = _get_session_or_404(code)
        if not data:
            return "Code invalide."

        # Ajoute le participant (on garde ton comportement : pas de blocage doublon)
        session_ref.collection("participants").add({
            "name": name,
            "vote": None,
            "avatarSeed": avatar_seed,
            "hasVoted": False
        })

        # Session Flask
        session["username"] = name
        session["session_id"] = code
        session["avatarSeed"] = avatar_seed

        return redirect(url_for("waiting", session_id=code))

    return render_template("join.html", avatars=AVATAR_SEEDS)


# =========================================================
# 10) WAITING ROOM : liste des joueurs
# =========================================================
@app.route("/waiting/<session_id>")
def waiting(session_id):
    """
    @brief Route `waiting`.
    @route /waiting/<session_id>
    """
    session_ref, session_data = _get_session_or_404(session_id)
    if not session_data:
        return "Session introuvable", 404

    participants = _participants_list(session_ref)

    return render_template(
        "waiting.html",
        session_id=session_id,
        session=session_data,
        participants=participants,
        current_user=session.get("username"),
    )


@app.route("/api/participants/<session_id>")
def api_participants(session_id):
    """
    @brief Route `api_participants`.
    @route /api/participants/<session_id>
    """
    session_ref, session_data = _get_session_or_404(session_id)
    if not session_data:
        return jsonify({"error": "session_not_found"}), 404

    participants = _participants_list(session_ref)
    return jsonify({
        "participants": participants,
        "status": session_data.get("status", "waiting")
    })


# =========================================================
# 11) START GAME : seul l’organisateur peut démarrer
# =========================================================
@app.route("/start/<session_id>", methods=["POST"])
def start(session_id):
    """
    @brief Route `start`.
    @route /start/<session_id>
    @methods POST
    """
    session_ref, session_data = _get_session_or_404(session_id)
    if not session_data:
        return "Session introuvable", 404

    username = _require_user()
    if username != session_data.get("organizer"):
        return "Non autorisé"

    # Reset des votes avant de commencer
    _reset_all_votes(session_ref)

    # IMPORTANT : on ne touche pas à currentStoryIndex ici
    session_ref.update({
        "status": "started",
        "reveal": False,
        "round_number": 1,
        "timerStart": int(time.time()),
    })

    return redirect(url_for("vote", session_id=session_id))


# =========================================================
# 12) VOTE : page principale
# =========================================================
@app.route("/vote/<session_id>", methods=["GET", "POST"])
def vote(session_id):
    """
    @brief Route `vote`.
    @route /vote/<session_id>
    @methods GET, POST
    """
    session_ref, data = _get_session_or_404(session_id)
    if not data:
        return "Session introuvable", 404

    if "username" not in session:
        return redirect(url_for("join"))

    username = session["username"]

    # POST : enregistre vote du joueur
    if request.method == "POST":
        vote_val = request.form.get("vote")

        # Optimisation : query au lieu de parcourir tous les participants
        updated = _update_participant_by_name(session_ref, username, {
            "vote": vote_val,
            "hasVoted": True
        })

        # Si le user n'est pas trouvé (edge case), on ne casse pas la page
        if not updated:
            # on peut choisir de l'ajouter (mais ça peut créer des doublons)
            session_ref.collection("participants").add({
                "name": username,
                "vote": vote_val,
                "avatarSeed": session.get("avatarSeed", AVATAR_SEEDS[0]),
                "hasVoted": True
            })

        return redirect(url_for("vote", session_id=session_id))

    # GET : construire participants (votes masqués selon règles)
    participants_full = _participants_list(session_ref)
    is_organizer = (username == data.get("organizer"))

    participants = []
    for p in participants_full:
        sanitized = {
            "name": p.get("name"),
            "avatarSeed": p.get("avatarSeed"),
            "hasVoted": p.get("hasVoted", False),
        }

        # Votes visibles si reveal OU orga OU soi-même
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


# =========================================================
# 13) REVEAL : l’organisateur révèle les cartes
# =========================================================
@app.route("/reveal/<session_id>", methods=["POST"])
def reveal(session_id):
    """
    @brief Route `reveal`.
    @route /reveal/<session_id>
    @methods POST
    """
    session_ref, data = _get_session_or_404(session_id)
    if not data:
        return "Session introuvable", 404

    username = _require_user()
    if username != data.get("organizer"):
        return "Non autorisé"

    if data.get("status") == "finished":
        return "Partie terminée", 400

    session_ref.update({"reveal": True})
    return redirect(url_for("vote", session_id=session_id))


# =========================================================
# 14) API GAME STATE : état temps réel
# =========================================================
@app.route("/api/game/<session_id>")
def api_game(session_id):
    """
    @brief Route `api_game`.
    @route /api/game/<session_id>
    """
    session_ref, data = _get_session_or_404(session_id)
    if not data:
        return jsonify({"error": "not_found"}), 404

    stories = data.get("userStories", [])
    idx = data.get("currentStoryIndex", 0)
    current_story = stories[idx] if 0 <= idx < len(stories) else ""

    participants_full = _participants_list(session_ref)

    current_user = session.get("username")
    is_current_organizer = (current_user == data.get("organizer"))

    votes_raw = [p.get("vote") for p in participants_full]

    all_cafe = bool(participants_full) and all(v == "☕" for v in votes_raw)
    all_voted = all(v is not None for v in votes_raw)

    # Unanimité : on ignore '?' et '☕'
    non_ignored_votes = [v for v in votes_raw if v is not None and v not in ("?", "☕")]
    unanimous = False
    unanimous_value = None
    if non_ignored_votes and all(x == non_ignored_votes[0] for x in non_ignored_votes):
        unanimous = True
        unanimous_value = non_ignored_votes[0]

    # Participants renvoyés au front (votes masqués)
    participants = []
    for p in participants_full:
        sanitized = {
            "name": p.get("name"),
            "avatarSeed": p.get("avatarSeed", AVATAR_SEEDS[0]),
            "hasVoted": p.get("hasVoted", False),
        }
        if data.get("reveal", False) or is_current_organizer or p.get("name") == current_user:
            sanitized["vote"] = p.get("vote")
        else:
            sanitized["vote"] = None
        participants.append(sanitized)

    # Pause café : si tout le monde met ☕, on passe en paused (une seule fois)
    if all_cafe and data.get("status") not in ("finished", "paused"):
        time_per_story = data.get("timePerStory", 5)
        timer_start = data.get("timerStart")
        pause_remaining = None

        if timer_start is not None:
            now = int(time.time())
            elapsed = now - int(timer_start)
            total = int(time_per_story) * 60
            pause_remaining = max(0, total - elapsed)

        session_ref.update({
            "status": "paused",
            "timerStart": None,
            "pauseRemaining": pause_remaining
        })

        data["status"] = "paused"
        data["timerStart"] = None
        data["pauseRemaining"] = pause_remaining

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
        "status": data.get("status", "waiting"),
        # "pauseRemaining": data.get("pauseRemaining")
    })


# =========================================================
# 15) RESUME : reprise après pause café
# =========================================================
@app.route("/resume/<session_id>", methods=["POST"])
def resume(session_id):
    """
    @brief Route `resume`.
    @route /resume/<session_id>
    @methods POST
    """
    session_ref, data = _get_session_or_404(session_id)
    if not data:
        return jsonify({"error": "not_found"}), 404

    if data.get("status") != "paused":
        return jsonify({"status": "ignored"}), 200

    time_per_story = data.get("timePerStory", 5)
    pause_remaining = data.get("pauseRemaining")
    now = int(time.time())

    if pause_remaining is None or pause_remaining <= 0:
        new_timer_start = now
    else:
        total_seconds = int(time_per_story) * 60
        new_timer_start = now - (total_seconds - int(pause_remaining))

    # Nettoyage votes pour relancer un tour
    _reset_all_votes(session_ref)

    session_ref.update({
        "status": "started",
        "timerStart": new_timer_start,
        "pauseRemaining": None
    })
    return jsonify({"status": "ok"})


# =========================================================
# 16) NEXT STORY : story suivante / fin de partie
# =========================================================
@app.route("/next_story/<session_id>", methods=["POST"])
def next_story(session_id):
    """
    @brief Route `next_story`.
    @route /next_story/<session_id>
    @methods POST
    """
    session_ref, data = _get_session_or_404(session_id)
    if not data:
        return jsonify({"error": "not_found"}), 404

    if data.get("status") == "finished":
        return jsonify({"error": "game_finished"}), 400

    stories = data.get("userStories", [])
    idx = data.get("currentStoryIndex", 0)
    history = data.get("history", [])

    req_data = request.get_json(silent=True) or {}
    result = req_data.get("result")

    # votes détaillés (pour historique)
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

    # Si pas de result envoyé par le front, on calcule une moyenne simple
    if result is None:
        votes_raw = [v.get("vote") for v in all_votes]
        all_cafe = bool(votes_raw) and all(v == "☕" for v in votes_raw)

        numeric_votes: List[float] = []
        for v in votes_raw:
            if v is None or v == "?" or (v == "☕" and not all_cafe):
                continue
            if v == "☕" and all_cafe:
                numeric_votes = []
                break
            try:
                numeric_votes.append(float(v))
            except Exception:
                continue

        if numeric_votes:
            avg = sum(numeric_votes) / len(numeric_votes)
            result = int(round(avg))
        else:
            result = None

        history[-1]["result"] = result

    update_payload: Dict[str, Any] = {"history": history}

    # Reset votes pour le prochain tour/story
    _reset_all_votes(session_ref)

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
        update_payload.update({
            "status": "finished",
            "reveal": True,
            "final_result": result,
            "timerStart": None
        })

    session_ref.update(update_payload)
    return jsonify({"status": "ok"})


# =========================================================
# 17) REVOTE : même story, nouveau tour
# =========================================================
@app.route("/revote/<session_id>", methods=["POST"])
def revote(session_id):
    """
    @brief Route `revote`.
    @route /revote/<session_id>
    @methods POST
    """
    session_ref, data = _get_session_or_404(session_id)
    if not data:
        return jsonify({"error": "not_found"}), 404

    if data.get("status") == "finished":
        return jsonify({"error": "game_finished"}), 400

    current_round = data.get("round_number", 1)

    _reset_all_votes(session_ref)

    session_ref.update({
        "reveal": False,
        "final_result": None,
        "round_number": int(current_round) + 1
    })

    return jsonify({"status": "ok"})


# =========================================================
# 18) CHAT API : GET/POST messages
# =========================================================
@app.route("/api/chat/<session_id>", methods=["GET", "POST"])
def api_chat(session_id):
    """
    @brief Route `api_chat`.
    @route /api/chat/<session_id>
    @methods GET, POST
    """
    session_ref, data = _get_session_or_404(session_id)
    if not data:
        return jsonify({"error": "not_found"}), 404

    if request.method == "POST":
        username = session.get("username")
        if not username:
            return jsonify({"error": "not_authenticated"}), 401

        body = request.get_json(silent=True) or {}
        text = (body.get("text") or "").strip()
        if not text:
            return jsonify({"error": "empty"}), 400

        session_ref.collection("chat").add({
            "sender": username,
            "text": text,
            "ts": int(time.time())
        })
        return jsonify({"status": "ok"}), 201

    msgs = []
    for doc in session_ref.collection("chat").order_by("ts").limit(200).stream():
        d = doc.to_dict()
        msgs.append({
            "sender": d.get("sender"),
            "text": d.get("text"),
            "ts": d.get("ts")
        })

    return jsonify({"messages": msgs})


# =========================================================
# 19) EXPORTS : état complet + résultats simples
# =========================================================
@app.route("/export_state/<session_id>")
def export_state(session_id):
    """
    @brief Route `export_state`.
    @route /export_state/<session_id>
    """
    session_ref, data = _get_session_or_404(session_id)
    if not data:
        return "Session introuvable", 404

    participants = _participants_list(session_ref)

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
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.route("/download_results/<session_id>")
def download_results(session_id):
    """
    @brief Route `download_results`.
    @route /download_results/<session_id>
    """
    session_ref, data = _get_session_or_404(session_id)
    if not data:
        return "Session introuvable", 404

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
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# =========================================================
# 20) RESUME FROM FILE : importer JSON -> nouvelle session
# =========================================================
@app.route("/resume_from_file", methods=["POST"])
def resume_from_file():
    """
    Crée une nouvelle session à partir d'un fichier JSON exporté.
    Logique :
    - Si history contient déjà N stories, on reprend à l'index N.
    - Si toutes les stories sont jouées, status=finished et index=dernière.
    - On ne recrée que l'organisateur comme participant actif.
    """
    resume_file = request.files.get("resume_file")
    if not resume_file or not resume_file.filename:
        return redirect(url_for("create"))

    try:
        imported_state = json.load(resume_file.stream)
    except Exception:
        return "Fichier JSON invalide", 400

    data = imported_state or {}
    stories = data.get("userStories", [])
    history = data.get("history", [])

    completed_count = len(history)

    if completed_count >= len(stories) and len(stories) > 0:
        new_status = "finished"
        new_index = len(stories) - 1
    else:
        new_status = "waiting"
        new_index = completed_count

    # Générer un code unique
    session_id = generate_session_id()
    session_ref = _session_ref(session_id)
    while session_ref.get().exists:
        session_id = generate_session_id()
        session_ref = _session_ref(session_id)

    organizer = data.get("organizer", "Organisateur")

    # Retrouver avatar orga si présent
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
        "history": history,
        "gameMode": data.get("gameMode", "strict"),
        "round_number": data.get("round_number", 1),
        "timePerStory": data.get("timePerStory", 5),
        "timerStart": None,
    })

    # Recréer seulement l'organisateur
    session_ref.collection("participants").add({
        "name": organizer,
        "vote": None,
        "avatarSeed": avatar_seed,
        "hasVoted": False,
    })

    session["username"] = organizer
    session["session_id"] = session_id
    session["avatarSeed"] = avatar_seed

    return redirect(url_for("waiting", session_id=session_id))


# =========================================================
# 21) Point d’entrée
# =========================================================
if __name__ == "__main__":
    # En prod (Render), c'est gunicorn qui démarre l'app.
    app.run(debug=True)
