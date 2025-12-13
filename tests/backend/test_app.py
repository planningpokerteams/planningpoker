# tests/backend/test_app.py

import time
import string
import json
import io

import pytest

from app import app, db, generate_session_id


# -------------------------------------------------------------------
# Fixtures et helpers Firestore
# -------------------------------------------------------------------


@pytest.fixture(autouse=True)
def cleanup_firestore():
    """
    Nettoie toutes les collections Firestore avant et après chaque test,
    y compris les sous-collections de premier niveau (participants).
    """
    def _clear():
        for collection in db.collections():
            for doc in collection.stream():
                # Supprimer toutes les sous-collections du document
                for subcol in doc.reference.collections():
                    for subdoc in subcol.stream():
                        subdoc.reference.delete()
                # Supprimer le document lui-même
                doc.reference.delete()

    # Avant le test
    _clear()
    yield
    # Après le test
    _clear()


@pytest.fixture
def client():
    """
    Client de test Flask avec contexte d'application actif.
    """
    app.config["TESTING"] = True
    with app.test_client() as client:
        with app.app_context():
            yield client


def create_session(session_id="TEST01", **overrides):
    """
    Crée une session Firestore de base pour les tests.
    """
    base_data = {
        "organizer": "Alice",
        "status": "waiting",
        "userStories": ["US 1", "US 2"],
        "currentStoryIndex": 0,
        "reveal": False,
        "final_result": None,
        "history": [],
        "gameMode": "strict",
        "round_number": 1,
        "timePerStory": 5,
        "timerStart": None,
    }
    base_data.update(overrides)

    session_ref = db.collection("sessions").document(session_id)
    session_ref.set(base_data)
    return session_ref


def add_participant(session_ref, name, avatar="astronaut", vote=None, has_voted=False):
    """
    Ajoute un participant à une session.
    """
    session_ref.collection("participants").add(
        {
            "name": name,
            "vote": vote,
            "avatarSeed": avatar,
            "hasVoted": has_voted,
        }
    )


# -------------------------------------------------------------------
# Tests utilitaires
# -------------------------------------------------------------------


def test_generate_session_id_format():
    """
    Le code de session est bien une chaîne de 6 caractères [A-Z0-9].
    """
    code = generate_session_id()
    assert len(code) == 6
    allowed = string.ascii_uppercase + string.digits
    assert all(c in allowed for c in code)


# -------------------------------------------------------------------
# Tests routes de base : index, create, join
# -------------------------------------------------------------------


def test_index_returns_200(client):
    """
    La page d'accueil / index répond en 200.
    """
    resp = client.get("/")
    assert resp.status_code == 200


def test_create_session_creates_firestore_doc_and_participant(client):
    """
    POST /create crée un document de session + ajoute l'organisateur
    comme participant avec vote=None et hasVoted=False.
    """
    data = {
        "organizer": "Alice",
        "userStories": ["Story 1", "Story 2"],
        "avatar_seed": "astronaut",
        "game_mode": "strict",
        "timePerStory": "5",
    }

    resp = client.post("/create", data=data)
    # Redirection vers la salle d'attente
    assert resp.status_code in (302, 303)

    sessions = list(db.collection("sessions").stream())
    assert len(sessions) == 1

    doc = sessions[0]
    session_data = doc.to_dict()

    assert session_data["organizer"] == "Alice"
    assert session_data["status"] == "waiting"
    assert session_data["userStories"] == ["Story 1", "Story 2"]
    assert session_data["currentStoryIndex"] == 0
    assert session_data["round_number"] == 1
    assert session_data["timePerStory"] == 5

    participants = list(doc.reference.collection("participants").stream())
    assert len(participants) == 1
    p = participants[0].to_dict()
    assert p["name"] == "Alice"
    assert p["avatarSeed"] == "astronaut"
    assert p["vote"] is None
    assert p["hasVoted"] is False


def test_join_invalid_code_returns_error_message(client):
    """
    POST /join avec un code inexistant retourne un message d'erreur.
    """
    resp = client.post(
        "/join",
        data={
            "code": "FAUXID",
            "name": "Bob",
            "avatar_seed": "ninja",
        },
    )
    assert resp.status_code == 200
    body = resp.get_data(as_text=True)
    assert "Code invalide" in body


def test_join_valid_code_adds_participant(client):
    """
    POST /join sur un code valide ajoute un participant dans Firestore.
    """
    session_id = "JOIN01"
    session_ref = create_session(session_id=session_id)

    resp = client.post(
        "/join",
        data={
            "code": session_id,
            "name": "Bob",
            "avatar_seed": "ninja",
        },
    )
    # Redirection vers la salle d'attente
    assert resp.status_code in (302, 303)

    participants = list(session_ref.collection("participants").stream())
    assert len(participants) == 1

    p = participants[0].to_dict()
    assert p["name"] == "Bob"
    assert p["avatarSeed"] == "ninja"
    assert p["vote"] is None
    assert p["hasVoted"] is False


# -------------------------------------------------------------------
# Tests salle d'attente + démarrage de partie
# -------------------------------------------------------------------


def test_waiting_page_404_if_session_not_found(client):
    """
    GET /waiting/<id> renvoie 404 si la session n'existe pas.
    """
    resp = client.get("/waiting/NOPE01")
    assert resp.status_code == 404


def test_waiting_page_ok_for_existing_session(client):
    """
    GET /waiting/<id> renvoie 200 pour une session existante.
    """
    session_id = "WAIT01"
    session_ref = create_session(session_id=session_id)
    add_participant(session_ref, "Alice")

    resp = client.get(f"/waiting/{session_id}")
    assert resp.status_code == 200
    text = resp.get_data(as_text=True)
    # On vérifie que le code de session apparaît dans la page
    assert session_id in text


def test_start_only_organizer_can_start(client):
    """
    Seul l'organisateur peut démarrer la partie via /start/<id>.
    """
    session_id = "START01"
    session_ref = create_session(session_id=session_id)
    add_participant(session_ref, "Alice")
    add_participant(session_ref, "Bob")

    # On se connecte en tant que Bob (non organisateur)
    with client.session_transaction() as sess:
        sess["username"] = "Bob"
        sess["session_id"] = session_id

    resp = client.post(f"/start/{session_id}")
    assert resp.status_code == 200
    assert "Non autorisé" in resp.get_data(as_text=True)


def test_start_keeps_index_and_resets_votes(client):
    """
    /start/<id> avec l'organisateur réinitialise les votes,
    passe le statut en 'started' et conserve currentStoryIndex.
    """
    session_id = "START02"
    # On part d'une story déjà sélectionnée (index=1)
    session_ref = create_session(session_id=session_id, currentStoryIndex=1)
    # Participants avec votes déjà posés
    add_participant(session_ref, "Alice", vote="3", has_voted=True)
    add_participant(session_ref, "Bob", vote="5", has_voted=True)

    with client.session_transaction() as sess:
        sess["username"] = "Alice"  # organizer
        sess["session_id"] = session_id

    resp = client.post(f"/start/{session_id}")
    assert resp.status_code in (302, 303)

    data = session_ref.get().to_dict()
    assert data["status"] == "started"
    # L'index ne doit plus être réinitialisé à 0
    assert data["currentStoryIndex"] == 1
    assert data["reveal"] is False
    assert data["round_number"] == 1
    assert isinstance(data["timerStart"], int)

    participants = list(session_ref.collection("participants").stream())
    assert len(participants) == 2
    for p_snap in participants:
        p = p_snap.to_dict()
        assert p["vote"] is None
        assert p["hasVoted"] is False


# -------------------------------------------------------------------
# Tests des votes et du reveal
# -------------------------------------------------------------------


def test_vote_route_records_vote_for_current_user(client):
    """
    POST /vote/<id> enregistre le vote du joueur courant dans Firestore.
    """
    session_id = "VOTE01"
    session_ref = create_session(session_id=session_id, status="started")
    add_participant(session_ref, "Bob", vote=None, has_voted=False)

    with client.session_transaction() as sess:
        sess["username"] = "Bob"
        sess["session_id"] = session_id

    resp = client.post(
        f"/vote/{session_id}",
        data={"vote": "5"},
    )
    assert resp.status_code in (302, 303)

    participants = list(session_ref.collection("participants").stream())
    assert len(participants) == 1
    p = participants[0].to_dict()
    assert p["vote"] == "5"
    assert p["hasVoted"] is True


def test_vote_redirects_to_join_if_no_session_user(client):
    """
    Si aucun username n'est présent dans la session Flask,
    /vote/<id> redirige vers /join.
    """
    session_id = "VOTE02"
    create_session(session_id=session_id, status="started")

    resp = client.get(f"/vote/{session_id}")
    # Redirection vers /join
    assert resp.status_code in (302, 303)
    assert "/join" in resp.headers["Location"]


def test_reveal_only_organizer_can_reveal(client):
    """
    Seul l'organisateur peut appeler /reveal/<id>.
    """
    session_id = "REV01"
    session_ref = create_session(session_id=session_id, status="started")

    with client.session_transaction() as sess:
        sess["username"] = "Bob"  # pas l'organisateur
        sess["session_id"] = session_id

    resp = client.post(f"/reveal/{session_id}")
    assert resp.status_code == 200
    assert "Non autorisé" in resp.get_data(as_text=True)

    # Organisateur
    with client.session_transaction() as sess:
        sess["username"] = "Alice"
        sess["session_id"] = session_id

    resp2 = client.post(f"/reveal/{session_id}")
    assert resp2.status_code in (302, 303)
    data = session_ref.get().to_dict()
    assert data["reveal"] is True


def test_reveal_after_game_finished_returns_error(client):
    """
    /reveal/<id> renvoie une erreur si la partie est déjà terminée.
    """
    session_id = "REV02"
    create_session(session_id=session_id, status="finished")

    with client.session_transaction() as sess:
        sess["username"] = "Alice"
        sess["session_id"] = session_id

    resp = client.post(f"/reveal/{session_id}")
    assert resp.status_code == 400
    assert "Partie terminée" in resp.get_data(as_text=True)


# -------------------------------------------------------------------
# Tests API game state / pause café / reprise
# -------------------------------------------------------------------


def test_api_game_returns_current_state_json(client):
    """
    /api/game/<id> renvoie bien la structure JSON attendue.
    """
    session_id = "API01"
    session_ref = create_session(session_id=session_id, status="started")
    add_participant(session_ref, "Alice")
    add_participant(session_ref, "Bob")

    resp = client.get(f"/api/game/{session_id}")
    assert resp.status_code == 200

    data = resp.get_json()
    assert "participants" in data
    assert "currentStory" in data
    assert "history" in data
    assert "gameMode" in data
    assert "roundNumber" in data
    assert "status" in data
    assert isinstance(data["participants"], list)


def test_api_game_all_cafe_puts_game_on_pause(client):
    """
    Si tous les joueurs votent '☕', l'API met le statut en 'paused'
    et stoppe le timer.
    """
    session_id = "API02"
    now = int(time.time())
    session_ref = create_session(
        session_id=session_id,
        status="started",
        timerStart=now,
        timePerStory=5,
    )
    add_participant(session_ref, "Alice", vote="☕", has_voted=True)
    add_participant(session_ref, "Bob", vote="☕", has_voted=True)

    resp = client.get(f"/api/game/{session_id}")
    assert resp.status_code == 200

    data = resp.get_json()
    assert data["status"] == "paused"

    updated = session_ref.get().to_dict()
    assert updated["status"] == "paused"
    assert updated["timerStart"] is None
    assert updated.get("pauseRemaining") is not None


def test_resume_from_paused_status(client):
    """
    /resume/<id> repart d'un statut 'paused', remet le timer en marche,
    nettoie les votes et enlève pauseRemaining.
    """
    session_id = "RES01"
    # Partie en pause avec des votes '☕'
    session_ref = create_session(
        session_id=session_id,
        status="paused",
        timePerStory=5,
        pauseRemaining=120,
        timerStart=None,
    )
    add_participant(session_ref, "Alice", vote="☕", has_voted=True)
    add_participant(session_ref, "Bob", vote="☕", has_voted=True)

    resp = client.post(f"/resume/{session_id}")
    assert resp.status_code == 200

    data = resp.get_json()
    assert data["status"] == "ok"

    updated = session_ref.get().to_dict()
    assert updated["status"] == "started"
    assert updated["pauseRemaining"] is None
    assert isinstance(updated["timerStart"], int)

    participants = list(session_ref.collection("participants").stream())
    for p_snap in participants:
        p = p_snap.to_dict()
        assert p["vote"] is None
        assert p["hasVoted"] is False


def test_resume_ignored_if_not_paused(client):
    """
    /resume/<id> renvoie status 'ignored' si la partie n'est pas en pause.
    """
    session_id = "RES02"
    create_session(session_id=session_id, status="started")

    resp = client.post(f"/resume/{session_id}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "ignored"


# -------------------------------------------------------------------
# Tests next_story / revote / fin de partie
# -------------------------------------------------------------------


def test_next_story_adds_history_and_advances_index(client):
    """
    /next_story/<id> ajoute une entrée dans history et passe à la story
    suivante quand il en reste.
    """
    session_id = "NEXT01"
    session_ref = create_session(
        session_id=session_id,
        status="started",
        userStories=["US 1", "US 2"],
        currentStoryIndex=0,
    )
    add_participant(session_ref, "Alice", vote="3", has_voted=True)
    add_participant(session_ref, "Bob", vote="5", has_voted=True)

    resp = client.post(
        f"/next_story/{session_id}",
        json={"result": "5"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "ok"

    updated = session_ref.get().to_dict()
    assert len(updated["history"]) == 1
    entry = updated["history"][0]
    assert entry["story"] == "US 1"
    assert entry["result"] == "5"
    assert isinstance(entry["votes"], list)
    assert len(entry["votes"]) == 2

    # Nouvelle story : index=1, statut started, reveal=False, round_number=1
    assert updated["currentStoryIndex"] == 1
    assert updated["status"] == "started"
    assert updated["reveal"] is False
    assert updated["final_result"] is None
    assert updated["round_number"] == 1
    assert isinstance(updated["timerStart"], int)

    # Votes reset pour la prochaine story
    participants = list(session_ref.collection("participants").stream())
    for p_snap in participants:
        p = p_snap.to_dict()
        assert p["vote"] is None
        assert p["hasVoted"] is False


def test_next_story_finishes_game_on_last_story(client):
    """
    /next_story/<id> passe le statut à 'finished' sur la dernière story
    et conserve le résultat final.
    """
    session_id = "NEXT02"
    session_ref = create_session(
        session_id=session_id,
        status="started",
        userStories=["US 1"],
        currentStoryIndex=0,
    )
    add_participant(session_ref, "Alice", vote="3", has_voted=True)

    resp = client.post(
        f"/next_story/{session_id}",
        json={"result": "3"},
    )
    assert resp.status_code == 200

    updated = session_ref.get().to_dict()
    assert updated["status"] == "finished"
    assert updated["reveal"] is True
    assert updated["final_result"] == "3"
    assert updated["timerStart"] is None
    assert len(updated["history"]) == 1


def test_next_story_error_if_game_finished(client):
    """
    /next_story/<id> renvoie une erreur si la partie est déjà finie.
    """
    session_id = "NEXT03"
    create_session(session_id=session_id, status="finished")

    resp = client.post(
        f"/next_story/{session_id}",
        json={"result": "5"},
    )
    assert resp.status_code == 400
    data = resp.get_json()
    assert data["error"] == "game_finished"


def test_revote_increments_round_and_resets_votes(client):
    """
    /revote/<id> incrémente le round_number et réinitialise les votes
    tant que la partie n'est pas terminée.
    """
    session_id = "REVOTE01"
    session_ref = create_session(
        session_id=session_id,
        status="started",
        round_number=2,
    )
    add_participant(session_ref, "Alice", vote="3", has_voted=True)
    add_participant(session_ref, "Bob", vote="5", has_voted=True)

    resp = client.post(f"/revote/{session_id}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "ok"

    updated = session_ref.get().to_dict()
    assert updated["round_number"] == 3
    assert updated["reveal"] is False
    assert updated["final_result"] is None

    participants = list(session_ref.collection("participants").stream())
    for p_snap in participants:
        p = p_snap.to_dict()
        assert p["vote"] is None
        assert p["hasVoted"] is False


def test_revote_error_if_game_finished(client):
    """
    /revote/<id> renvoie une erreur si la partie est finie.
    """
    session_id = "REVOTE02"
    create_session(session_id=session_id, status="finished")

    resp = client.post(f"/revote/{session_id}")
    assert resp.status_code == 400
    data = resp.get_json()
    assert data["error"] == "game_finished"


# -------------------------------------------------------------------
# Tests export / import JSON
# -------------------------------------------------------------------


def test_download_results_returns_json_attachment(client):
    """
    /download_results/<id> renvoie un fichier JSON avec les infos
    de la session et de son historique.
    """
    session_id = "DL01"
    session_ref = create_session(
        session_id=session_id,
        status="finished",
        history=[
            {
                "story": "US 1",
                "result": "5",
                "votes": [
                    {"name": "Alice", "avatar": "astronaut", "vote": "5"},
                ],
            }
        ],
    )
    add_participant(session_ref, "Alice")

    resp = client.get(f"/download_results/{session_id}")
    assert resp.status_code == 200
    assert resp.mimetype == "application/json"
    dispo = resp.headers.get("Content-Disposition", "")
    assert f"poker_results_{session_id}.json" in dispo

    data = json.loads(resp.get_data(as_text=True))
    assert data["sessionId"] == session_id
    assert data["organizer"] == "Alice"
    assert data["status"] == "finished"
    assert data["gameMode"] == "strict"
    assert data["userStories"] == ["US 1", "US 2"]
    assert len(data["history"]) == 1


def test_export_state_returns_full_session_state(client):
    """
    /export_state/<id> renvoie l'état complet de la session (participants,
    stories, index courant, historique...).
    """
    session_id = "EXP01"
    session_ref = create_session(
        session_id=session_id,
        status="started",
        userStories=["US 1", "US 2"],
        currentStoryIndex=1,
        history=[
            {
                "story": "US 1",
                "result": "3",
                "votes": [
                    {"name": "Alice", "avatar": "astronaut", "vote": "3"},
                ],
            }
        ],
    )
    add_participant(session_ref, "Alice", vote="5", has_voted=True)

    resp = client.get(f"/export_state/{session_id}")
    assert resp.status_code == 200
    assert resp.mimetype == "application/json"
    dispo = resp.headers.get("Content-Disposition", "")
    assert f"poker_state_{session_id}.json" in dispo

    data = json.loads(resp.get_data(as_text=True))
    # Champs principaux
    assert data["sessionId"] == session_id
    assert data["organizer"] == "Alice"
    assert data["status"] == "started"
    assert data["gameMode"] == "strict"
    assert data["timePerStory"] == 5
    assert data["userStories"] == ["US 1", "US 2"]
    assert data["currentStoryIndex"] == 1
    assert data["round_number"] == 1
    # Historique et participants exportés
    assert isinstance(data["history"], list)
    assert len(data["history"]) == 1
    assert isinstance(data["participants"], list)
    assert len(data["participants"]) == 1
    p = data["participants"][0]
    assert p["name"] == "Alice"
    assert p["vote"] == "5"
    assert p["avatarSeed"] == "astronaut"
    assert p["hasVoted"] is True


def test_resume_from_file_continues_on_first_unplayed_story(client):
    """
    /resume_from_file repart sur la première user story non présente
    dans l'historique, avec statut waiting.
    """
    exported = {
        "organizer": "Alice",
        "userStories": ["US 1", "US 2", "US 3"],
        # On a déjà joué US 1 et US 2
        "history": [
            {"story": "US 1", "result": "3", "votes": []},
            {"story": "US 2", "result": "5", "votes": []},
        ],
        "gameMode": "strict",
        "round_number": 1,
        "timePerStory": 5,
        "participants": [
            {"name": "Alice", "avatarSeed": "astronaut", "vote": None, "hasVoted": False}
        ],
    }

    data = {
        "resume_file": (
            io.BytesIO(json.dumps(exported).encode("utf-8")),
            "state.json",
        )
    }

    resp = client.post("/resume_from_file", data=data, content_type="multipart/form-data")
    # Redirection vers /waiting/<nouveau_code>
    assert resp.status_code in (302, 303)

    # Récupérer la nouvelle session créée
    sessions = list(db.collection("sessions").stream())
    assert len(sessions) == 1
    doc = sessions[0]
    session_data = doc.to_dict()

    assert session_data["organizer"] == "Alice"
    assert session_data["userStories"] == ["US 1", "US 2", "US 3"]
    # 2 stories dans l'historique → on repart sur l'index 2 (US 3)
    assert session_data["currentStoryIndex"] == 2
    assert session_data["status"] == "waiting"
    assert len(session_data["history"]) == 2

    # Un seul participant recréé : l'organisatrice
    participants = list(doc.reference.collection("participants").stream())
    assert len(participants) == 1
    p = participants[0].to_dict()
    assert p["name"] == "Alice"
    assert p["avatarSeed"] == "astronaut"
    assert p["vote"] is None
    assert p["hasVoted"] is False


def test_resume_from_file_marks_finished_if_all_stories_played(client):
    """
    /resume_from_file met la partie en finished si toutes les
    user stories sont déjà dans l'historique.
    """
    exported = {
        "organizer": "Alice",
        "userStories": ["US 1", "US 2"],
        "history": [
            {"story": "US 1", "result": "3", "votes": []},
            {"story": "US 2", "result": "5", "votes": []},
        ],
        "gameMode": "strict",
        "round_number": 1,
        "timePerStory": 5,
        "participants": [],
    }

    data = {
        "resume_file": (
            io.BytesIO(json.dumps(exported).encode("utf-8")),
            "state.json",
        )
    }

    resp = client.post("/resume_from_file", data=data, content_type="multipart/form-data")
    assert resp.status_code in (302, 303)

    sessions = list(db.collection("sessions").stream())
    assert len(sessions) == 1
    doc = sessions[0]
    session_data = doc.to_dict()

    assert session_data["status"] == "finished"
    # index positionné sur la dernière story
    assert session_data["currentStoryIndex"] == 1
    assert len(session_data["history"]) == 2


def test_api_game_unanimity_ignores_question_and_coffee(client):
    session_id = "UNI01"
    session_ref = create_session(session_id=session_id, status="started")
    add_participant(session_ref, "A", vote="?", has_voted=True)
    add_participant(session_ref, "B", vote="3", has_voted=True)

    resp = client.get(f"/api/game/{session_id}")
    assert resp.status_code == 200
    data = resp.get_json()
    # on attend unanimity True sur la valeur 3 (le '?' est ignoré)
    assert data.get("unanimous") is True
    assert str(data.get("unanimousValue")) == "3"


def test_api_game_all_cafe_and_unanimous(client):
    session_id = "UNI02"
    session_ref = create_session(session_id=session_id, status="started")
    add_participant(session_ref, "A", vote="☕", has_voted=True)
    add_participant(session_ref, "B", vote="☕", has_voted=True)

    resp = client.get(f"/api/game/{session_id}")
    data = resp.get_json()
    assert data.get("allCafe") is True
    # unanimousValue devrait être None (pas de valeur numérique)
    assert data.get("unanimous") is False or data.get("unanimousValue") is None

def test_chat_api_post_and_get(client):
    session_id = "CHAT01"
    session_ref = create_session(session_id=session_id, status="started")
    add_participant(session_ref, "Alice")
    # se connecter comme Alice
    with client.session_transaction() as sess:
        sess["username"] = "Alice"
        sess["session_id"] = session_id

    # poster un message
    resp = client.post(f"/api/chat/{session_id}", json={"text": "Bonjour"})
    assert resp.status_code == 201

    # récupérer les messages
    resp2 = client.get(f"/api/chat/{session_id}")
    data = resp2.get_json()
    msgs = data.get("messages", [])
    assert any(m["text"] == "Bonjour" and m["sender"] == "Alice" for m in msgs)
    