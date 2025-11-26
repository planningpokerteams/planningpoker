from flask import Flask, render_template, request, redirect, url_for, session, jsonify
import os
import random, string
import firebase_admin
from firebase_admin import credentials, firestore


app = Flask(__name__)
app.secret_key = "une_grosse_chaine_aleatoire_que_tu_genere"

# -------------------------------
# Initialisation Firebase
# -------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SERVICE_ACCOUNT_FILE = os.path.join(
    BASE_DIR,
    "pokerplanning-749a9-firebase-adminsdk-fbsvc-90ec4208bf.json"  # <- adapte le nom si besoin
)

if not firebase_admin._apps:
    cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# -------------------------------
# Avatars DiceBear (seeds)
# -------------------------------

AVATAR_SEEDS = [
    "astronaut",
    "ninja",
    "pirate",
    "wizard",
    "gamer",
    "robot",
    "detective",
    "viking",
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

        # Création de la session
        session_ref.set({
            'organizer': organizer,
            'difficulty': difficulty,
            'rounds': rounds,
            'status': 'waiting',
            'userStories': user_stories
        })

        # L’organisateur est aussi un participant avec avatar
        session_ref.collection('participants').add({
            'name': organizer,
            'vote': None,
            'avatarSeed': avatar_seed
        })

        # Session Flask
        session['username'] = organizer
        session['session_id'] = session_id
        session['avatarSeed'] = avatar_seed

        return redirect(url_for('waiting', session_id=session_id))

    # GET → on envoie la liste des avatars au template
    return render_template('create.html', avatars=AVATAR_SEEDS)


@app.route('/join', methods=['GET', 'POST'])
def join():
    if request.method == 'POST':
        code = request.form['code']
        name = request.form['name']
        avatar_seed = request.form.get('avatar_seed', AVATAR_SEEDS[0])

        session_ref = db.collection('sessions').document(code)

        if not session_ref.get().exists:
            return "Code invalide. Veuillez réessayer."

        # Ajout du participant avec avatar
        session_ref.collection('participants').add({
            'name': name,
            'vote': None,
            'avatarSeed': avatar_seed
        })

        # Session Flask
        session['username'] = name
        session['session_id'] = code
        session['avatarSeed'] = avatar_seed

        return redirect(url_for('waiting', session_id=code))

    # GET → on envoie la liste des avatars au template
    return render_template('join.html', avatars=AVATAR_SEEDS)


@app.route('/waiting/<session_id>')
def waiting(session_id):
    session_ref = db.collection('sessions').document(session_id)
    session_data = session_ref.get().to_dict()
    participants = [p.to_dict() for p in session_ref.collection('participants').stream()]

    return render_template(
        'waiting.html',
        session_id=session_id,
        session=session_data,
        participants=participants,
        current_user=session.get('username')
    )


@app.route('/api/participants/<session_id>')
def api_participants(session_id):
    """API polled par la salle d'attente pour :
       - rafraîchir la liste des participants
       - savoir si la partie a démarré (status).
    """
    session_ref = db.collection('sessions').document(session_id)
    session_doc = session_ref.get()

    if not session_doc.exists:
        return jsonify({"error": "session_not_found"}), 404

    session_data = session_doc.to_dict()
    raw_participants = [p.to_dict() for p in session_ref.collection('participants').stream()]

    participants = [
        {
            "name": p.get("name"),
            "vote": p.get("vote"),
            "avatarSeed": p.get("avatarSeed", AVATAR_SEEDS[0])
        }
        for p in raw_participants
    ]

    return jsonify({
        "participants": participants,
        "status": session_data.get("status", "waiting")  # 'waiting' ou 'started'
    })


@app.route('/start/<session_id>', methods=['POST'])
def start(session_id):
    session_ref = db.collection('sessions').document(session_id)
    session_doc = session_ref.get()

    if not session_doc.exists:
        return "Session introuvable", 404

    session_data = session_doc.to_dict() or {}

    username = session.get('username') or request.form.get('username')

    app.logger.info(
        "Start appelé pour session %s : username=%s / organizer=%s",
        session_id,
        username,
        session_data.get('organizer')
    )

    if not username or username != session_data.get('organizer'):
        return "Vous n'êtes pas autorisé à lancer la partie."

    # On initialise l’index de story et on indique que les cartes ne sont pas révélées
    session_ref.update({
        'status': 'started',
        'currentStoryIndex': 0,
        'reveal': False
    })

    # Optionnel : reset des votes avant de commencer
    for p in session_ref.collection('participants').stream():
        p.reference.update({'vote': None})

    return redirect(url_for('vote', session_id=session_id))


@app.route('/vote/<session_id>', methods=['GET', 'POST'])
def vote(session_id):
    session_ref = db.collection('sessions').document(session_id)
    session_doc = session_ref.get()

    if not session_doc.exists:
        return "Session introuvable", 404

    session_data = session_doc.to_dict() or {}

    if 'username' not in session:
        return redirect(url_for('join'))

    username = session['username']
    avatar_seed = session.get('avatarSeed', 'astronaut')

    if request.method == 'POST':
        # Vote de l'utilisateur
        vote_value = request.form['vote']
        participants_ref = session_ref.collection('participants')

        found = False
        for p in participants_ref.stream():
            data = p.to_dict()
            if data.get('name') == username:
                p.reference.update({'vote': vote_value})
                found = True
                break

        if not found:
            participants_ref.add({
                'name': username,
                'vote': vote_value,
                'avatarSeed': avatar_seed
            })

        return redirect(url_for('vote', session_id=session_id))

    # GET : affichage initial (le détail sera ensuite rafraîchi via /api/game)
    participants = [p.to_dict() for p in session_ref.collection('participants').stream()]
    is_organizer = (username == session_data.get('organizer'))

    return render_template(
        'vote.html',
        session=session_data,
        participants=participants,
        session_id=session_id,
        current_user=username,
        is_organizer=is_organizer
    )

    session_ref = db.collection('sessions').document(session_id)
    session_data = session_ref.get().to_dict()

    # L'utilisateur doit avoir un pseudo en session
    if 'username' not in session:
        return redirect(url_for('join'))

    username = session['username']
    avatar_seed = session.get('avatarSeed', AVATAR_SEEDS[0])

    if request.method == 'POST':
        vote_value = request.form['vote']
        participants_ref = session_ref.collection('participants')

        found = False
        for p in participants_ref.stream():
            data = p.to_dict()
            if data.get('name') == username:
                p.reference.update({'vote': vote_value})
                found = True
                break

        # Si pour une raison quelconque le participant n'existe pas, on le crée (avec avatar)
        if not found:
            participants_ref.add({
                'name': username,
                'vote': vote_value,
                'avatarSeed': avatar_seed
            })

        return redirect(url_for('vote', session_id=session_id))

    participants = [p.to_dict() for p in session_ref.collection('participants').stream()]
    return render_template('vote.html', session=session_data, participants=participants)

@app.route('/reveal/<session_id>', methods=['POST'])
def reveal(session_id):
    session_ref = db.collection('sessions').document(session_id)
    session_doc = session_ref.get()

    if not session_doc.exists:
        return "Session introuvable", 404

    session_data = session_doc.to_dict() or {}
    username = session.get('username') or request.form.get('username')

    if not username or username != session_data.get('organizer'):
        return "Vous n'êtes pas autorisé à révéler les cartes."

    session_ref.update({'reveal': True})
    return redirect(url_for('vote', session_id=session_id))

@app.route('/api/game/<session_id>')
def api_game(session_id):
    """État de la partie pour la phase de vote."""
    session_ref = db.collection('sessions').document(session_id)
    session_doc = session_ref.get()

    if not session_doc.exists:
        return jsonify({"error": "session_not_found"}), 404

    session_data = session_doc.to_dict() or {}
    user_stories = session_data.get('userStories', [])
    current_index = session_data.get('currentStoryIndex', 0)
    current_story = user_stories[current_index] if 0 <= current_index < len(user_stories) else ""

    participants_ref = session_ref.collection('participants')
    raw_participants = [p.to_dict() for p in participants_ref.stream()]

    participants = []
    all_voted = True
    for p in raw_participants:
        has_voted = p.get('vote') is not None
        if not has_voted:
            all_voted = False

        participants.append({
            "name": p.get("name"),
            "avatarSeed": p.get("avatarSeed", "astronaut"),
            # On n’envoie la valeur de vote que si reveal = True
            "vote": p.get("vote") if session_data.get("reveal") else None,
            "hasVoted": has_voted,
        })

    return jsonify({
        "participants": participants,
        "allVoted": all_voted,
        "reveal": session_data.get("reveal", False),
        "currentStory": current_story,
    })

# ---------------------------------------------------------
# Lancer l'application
# ---------------------------------------------------------

if __name__ == '__main__':
    app.run(debug=True)
