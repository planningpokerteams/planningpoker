
import pytest
from unittest.mock import patch, MagicMock
from app import app

@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

# ---------------------- MOCK FIRESTORE ----------------------
class MockDoc:
    def __init__(self, exists=True, data=None):
        self.exists = exists
        self._data = data or {}
        self.reference = MagicMock()

    def get(self):
        return self

    def to_dict(self):
        return self._data

    def set(self, data):
        self._data.update(data)

    def update(self, data):
        self._data.update(data)

    def collection(self, name):
        return MockCollection()

class MockCollection:
    def __init__(self, docs=None):
        self.docs = docs or []

    def document(self, _):
        return self.docs[0] if self.docs else MockDoc()

    def stream(self):
        return self.docs

    def add(self, data):
        return None

# ---------------------- TESTS ----------------------

def test_index(client):
    response = client.get('/')
    assert response.status_code == 200
    assert b'<html' in response.data

def test_create_post(client):
    mock_doc = MockDoc()
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        response = client.post('/create', data={
            'organizer': 'Alice',
            'difficulty': 'medium',
            'rounds': '3',
            'userStories': ['Story1', 'Story2'],
            'avatar_seed': 'wizard'
        })
        assert response.status_code == 302
        assert '/waiting/' in response.headers['Location']

def test_join_success(client):
    mock_doc = MockDoc(exists=True)
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        response = client.post('/join', data={'code': 'ABC123', 'name': 'Bob'})
        assert response.status_code == 302
        assert '/waiting/ABC123' in response.headers['Location']

def test_join_invalid(client):
    mock_doc = MockDoc(exists=False)
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        response = client.post('/join', data={'code': 'INVALID', 'name': 'Bob'})
        assert response.status_code == 200
        assert b'Code invalide' in response.data

def test_waiting(client):
    mock_doc = MockDoc(data={'organizer': 'Alice'})
    participants = [MockDoc(data={'name': 'Alice'})]
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        mock_doc.collection = lambda name: MockCollection(participants)
        response = client.get('/waiting/ABC123')
        assert response.status_code == 200
        assert b'Alice' in response.data

def test_api_participants(client):
    mock_doc = MockDoc(exists=True, data={'status': 'waiting'})
    participants = [MockDoc(data={'name': 'Alice'})]
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        mock_doc.collection = lambda name: MockCollection(participants)
        response = client.get('/api/participants/ABC123')
        assert response.status_code == 200
        json_data = response.get_json()
        assert 'participants' in json_data

def test_start(client):
    mock_doc = MockDoc(exists=True, data={'organizer': 'Alice'})
    participants = [MockDoc(data={'name': 'Alice'})]
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        mock_doc.collection = lambda name: MockCollection(participants)
        with client.session_transaction() as sess:
            sess['username'] = 'Alice'
        response = client.post('/start/ABC123')
        assert response.status_code == 302
        assert '/vote/ABC123' in response.headers['Location']

def test_vote_get(client):
    mock_doc = MockDoc(data={'organizer': 'Alice'})
    participants = [MockDoc(data={'name': 'Alice'})]
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        mock_doc.collection = lambda name: MockCollection(participants)
        with client.session_transaction() as sess:
            sess['username'] = 'Alice'
        response = client.get('/vote/ABC123')
        assert response.status_code == 200
        assert b'Alice' in response.data

def test_reveal(client):
    mock_doc = MockDoc(data={'organizer': 'Alice'})
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        with client.session_transaction() as sess:
            sess['username'] = 'Alice'
        response = client.post('/reveal/ABC123')
        assert response.status_code == 302
        assert '/vote/ABC123' in response.headers['Location']

def test_api_game(client):
    mock_doc = MockDoc(exists=True, data={'userStories': ['Story1'], 'currentStoryIndex': 0})
    participants = [MockDoc(data={'name': 'Alice', 'vote': None})]
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        mock_doc.collection = lambda name: MockCollection(participants)
        response = client.get('/api/game/ABC123')
        assert response.status_code == 200
        json_data = response.get_json()
        assert 'participants' in json_data

def test_next_story(client):
    mock_doc = MockDoc(exists=True, data={'userStories': ['Story1', 'Story2'], 'currentStoryIndex': 0, 'history': []})
    participants = [MockDoc(data={'name': 'Alice'})]
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        mock_doc.collection = lambda name: MockCollection(participants)
        response = client.post('/next_story/ABC123')
        assert response.status_code == 200
        assert response.get_json()['status'] == 'ok'

def test_revote(client):
    mock_doc = MockDoc(exists=True)
    participants = [MockDoc(data={'name': 'Alice'})]
    with patch('app.db.collection', return_value=MockCollection([mock_doc])):
        mock_doc.collection = lambda name: MockCollection(participants)
        response = client.post('/revote/ABC123')
        assert response.status_code == 200
