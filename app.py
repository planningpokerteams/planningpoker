from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import os
import random, string
import firebase_admin
from firebase_admin import credentials, firestore

app = Flask(__name__)
app.secret_key = "une_grosse_chaine_aleatoire_que_tu_genere"

# -------------------------------
# Firebase
# -------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_ACCOUNT_FILE = os.path.join(
    BASE_DIR,
    "pokerplanning-749a9-firebase-adminsdk-fbsvc-7422ebcd6e.json"
)

if not firebase_admin._apps:
    cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
    firebase_admin.initialize_app(cred)

db = firestore.client()

AVATAR_SEEDS = [
    "astronaut", "ninja", "pirate", "wizard",
    "gamer", "robot", "detective", "viking"
]


# ---------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------
def generate_session_id():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


# ---------------------------------------------------------
# ROUTES
# ---------------------------------------------------------
@app.route('/')
def index():
    return render_template('index.html')


# ---------------------------------------------------------
# CRÉATION SESSION
# ---------------------------------------------------------
@app.route('/create', methods=['GET', 'POST'])
def create():
    if request.method == 'POST':
        organizer = request.form['organizer']
        difficulty = request.form['difficulty']
        rounds = request.form['rounds']
        user_stories = request.form.getlist('userStories')
        avatar_seed = request.form.get('avatar_seed', AVATAR_SEEDS[0])

        session_id = generate_session_id()
        session_ref = db.collection('sessions').document(session_id)

        # Création de la session (TOUS LES CHAMPS IMPORTANTS)
        session_ref.set({
            "organizer": organizer,
            "difficulty": difficulty,
            "rounds": rounds,
            "status": "waiting",
            "userStories": user_stories,
            "currentStoryIndex": 0,
            "reveal": False,
            "final_result": None,
            "history": []   # <-- NECESSAIRE POUR L'HISTORIQUE
        })

        # Ajouter l'organisateur
        session_ref.collection("participants").add({
            "name": organizer,
            "vote": None,
            "avatarSeed": avatar_seed,
            "hasVoted": False
        })

        # Session Flask
        session["username"] = organizer
        session["session_id"] = session_id
        session["avatarSeed"] = avatar_seed

        return redirect(url_for('waiting', session_id=session_id))

    return render_template("create.html", avatars=AVATAR_SEEDS)


# ---------------------------------------------------------
# REJOINDRE
# ---------------------------------------------------------
@app.route('/join', methods=['GET', 'POST'])
def join():
    if request.method == 'POST':
        code = request.form['code']
        name = request.form['name']
        avatar_seed = request.form.get('avatar_seed', AVATAR_SEEDS[0])

        session_ref = db.collection("sessions").document(code)
        if not session_ref.get().exists:
            return "Code invalide."

        session_ref.collection("participants").add({
            "name": name,
            "vote": None,
            "avatarSeed": avatar_seed,
            "hasVoted": False
        })

        session["username"] = name
        session["session_id"] = code
        session["avatarSeed"] = avatar_seed

        return redirect(url_for("waiting", session_id=code))

    return render_template("join.html", avatars=AVATAR_SEEDS)


# ---------------------------------------------------------
# SALLE D'ATTENTE
# ---------------------------------------------------------
@app.route('/waiting/<session_id>')
def waiting(session_id):
    session_ref = db.collection('sessions').document(session_id)
    session_data = session_ref.get().to_dict()
    participants = [p.to_dict() for p in session_ref.collection('participants').stream()]

    return render_template("waiting.html",
                           session_id=session_id,
                           session=session_data,
                           participants=participants,
                           current_user=session.get("username")
                           )


# ---------------------------------------------------------
# API PARTICIPANTS
# ---------------------------------------------------------
@app.route('/api/participants/<session_id>')
def api_participants(session_id):
    session_ref = db.collection("sessions").document(session_id)
    if not session_ref.get().exists:
        return jsonify({"error": "session_not_found"}), 404

    session_data = session_ref.get().to_dict()
    participants = [
        p.to_dict() for p in session_ref.collection("participants").stream()
    ]

    return jsonify({
        "participants": participants,
        "status": session_data.get("status", "waiting")
    })


# ---------------------------------------------------------
# DÉMARRAGE PARTIE
# ---------------------------------------------------------
@app.route('/start/<session_id>', methods=['POST'])
def start(session_id):
    session_ref = db.collection("sessions").document(session_id)
    if not session_ref.get().exists:
        return "Session introuvable", 404

    username = session.get("username")

    # Only organizer
    session_data = session_ref.get().to_dict()
    if username != session_data.get("organizer"):
        return "Vous n'êtes pas autorisé"

    # Reset votes
    for p in session_ref.collection("participants").stream():
        p.reference.update({"vote": None, "hasVoted": False})

    session_ref.update({
        "status": "started",
        "currentStoryIndex": 0,
        "reveal": False
    })

    return redirect(url_for("vote", session_id=session_id))


# ---------------------------------------------------------
# PAGE VOTE
# ---------------------------------------------------------
@app.route('/vote/<session_id>', methods=['GET', 'POST'])
def vote(session_id):
    session_ref = db.collection("sessions").document(session_id)
    session_data = session_ref.get().to_dict()

    if "username" not in session:
        return redirect(url_for("join"))

    username = session["username"]

    if request.method == "POST":
        vote_val = request.form["vote"]
        for p in session_ref.collection("participants").stream():
            if p.to_dict().get("name") == username:
                p.reference.update({"vote": vote_val, "hasVoted": True})
                break
        return redirect(url_for("vote", session_id=session_id))

    participants = [p.to_dict() for p in session_ref.collection("participants").stream()]
    is_organizer = (username == session_data.get("organizer"))

    return render_template("vote.html",
                           session=session_data,
                           participants=participants,
                           session_id=session_id,
                           current_user=username,
                           is_organizer=is_organizer)


# ---------------------------------------------------------
# RÉVÉLER LES CARTES
# ---------------------------------------------------------
@app.route('/reveal/<session_id>', methods=['POST'])
def reveal(session_id):
    session_ref = db.collection("sessions").document(session_id)
    data = session_ref.get().to_dict()
    username = session.get("username")

    if username != data.get("organizer"):
        return "Non autorisé"

    session_ref.update({"reveal": True})
    return redirect(url_for("vote", session_id=session_id))


# ---------------------------------------------------------
# API ÉTAT DE JEU
# ---------------------------------------------------------
@app.route('/api/game/<session_id>')
def api_game(session_id):
    session_ref = db.collection("sessions").document(session_id)
    if not session_ref.get().exists:
        return jsonify({"error": "not_found"}), 404

    data = session_ref.get().to_dict() or {}

    # stories
    stories = data.get("userStories", [])
    idx = data.get("currentStoryIndex", 0)
    current_story = stories[idx] if idx < len(stories) else ""

    # participants
    participants_raw = [p.to_dict() for p in session_ref.collection("participants").stream()]
    participants = []
    all_voted = True

    for p in participants_raw:
        has_voted = p.get("vote") is not None
        if not has_voted:
            all_voted = False

        participants.append({
            "name": p["name"],
            "avatarSeed": p.get("avatarSeed", "astronaut"),
            "vote": p.get("vote") if data.get("reveal") else None,
            "hasVoted": has_voted
        })

    return jsonify({
        "participants": participants,
        "allVoted": all_voted,
        "reveal": data.get("reveal", False),
        "currentStory": current_story,
        "history": data.get("history", [])
    })


# ---------------------------------------------------------
# NEXT STORY
# ---------------------------------------------------------
@app.route('/next_story/<session_id>', methods=['POST'])
def next_story(session_id):
    session_ref = db.collection("sessions").document(session_id)
    doc = session_ref.get()
    if not doc.exists:
        return jsonify({"error": "not_found"}), 404

    data = doc.to_dict()
    stories = data.get("userStories", [])
    idx = data.get("currentStoryIndex", 0)
    history = data.get("history", [])

    # result
    result = data.get("final_result")
    history.append({
        "story": stories[idx] if idx < len(stories) else "",
        "result": result
    })

    # next index
    idx = min(idx + 1, len(stories) - 1)

    # reset votes
    for p in session_ref.collection('participants').stream():
        p.reference.update({"vote": None, "hasVoted": False})

    session_ref.update({
        "history": history,
        "currentStoryIndex": idx,
        "reveal": False,
        "final_result": None
    })

    return jsonify({"status": "ok"})


# ---------------------------------------------------------
# REVOTE
# ---------------------------------------------------------
@app.route('/revote/<session_id>', methods=['POST'])
def revote(session_id):
    session_ref = db.collection("sessions").document(session_id)
    if not session_ref.get().exists:
        return jsonify({"error": "not_found"}), 404

    for p in session_ref.collection("participants").stream():
        p.reference.update({"vote": None, "hasVoted": False})

    session_ref.update({"reveal": False, "final_result": None})

    return jsonify({"status": "ok"})


# ---------------------------------------------------------
if __name__ == '__main__':
    app.run(debug=True)
