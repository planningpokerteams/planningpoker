// Script d'attente des participants avant le début de la partie
document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------------------
    // Récupération du sessionId à partir de l'attribut data-session-id
    // sur l'élément <main class="hero" ...>
    // ----------------------------------------------------------------
    const mainEl = document.querySelector('main.hero[data-session-id]');
    const sessionId = mainEl ? mainEl.dataset.sessionId : null;

    // ----------------------------------------------------------------
    // Chronomètre d'attente dans la salle (affiche le temps écoulé)
    // ----------------------------------------------------------------
    (function startWaitingTimer() {
        const timerEl = document.getElementById('waiting-timer');
        if (!timerEl) return; // pas de chrono sur cette page

        const span = timerEl.querySelector('span');
        let elapsedSeconds = 0; // temps écoulé depuis l'arrivée dans la salle

        // Formate les secondes en mm:ss
        function formatTime(totalSeconds) {
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return (
                String(minutes).padStart(2, '0') +
                ':' +
                String(seconds).padStart(2, '0')
            );
        }

        // Initialisation de l’affichage
        span.textContent = formatTime(elapsedSeconds);

        // Incrémente et met à jour l’affichage toutes les secondes
        setInterval(() => {
            elapsedSeconds++;
            span.textContent = formatTime(elapsedSeconds);
        }, 1000);
    })();

    // ----------------------------------------------------------------
    // Rafraîchissement périodique de la liste des participants
    // + redirection vers la page de vote quand la partie démarre
    // ----------------------------------------------------------------
    function refreshParticipants() {
        if (!sessionId) return; // sécurité si l’ID de session est absent

        fetch(`/api/participants/${sessionId}`)
            .then(response => response.json())
            .then(data => {
                const ul = document.getElementById('participants-list');
                if (!ul) return;

                // Vide la liste avant de la re-remplir
                ul.innerHTML = "";

                // Ajoute un <li> par participant avec avatar + nom
                (data.participants || []).forEach(p => {
                    const li = document.createElement('li');
                    li.className = 'participant-item';

                    const img = document.createElement('img');
                    img.className = 'avatar-icon';
                    img.src = `https://api.dicebear.com/9.x/avataaars/svg?seed=${
                        encodeURIComponent(p.avatarSeed || 'astronaut')
                    }&backgroundColor=b6e3f4&radius=50`;
                    img.alt = `avatar ${p.name}`;

                    const span = document.createElement('span');
                    span.textContent = p.name;

                    li.appendChild(img);
                    li.appendChild(span);
                    ul.appendChild(li);
                });

                // Si le statut passe à "started", on bascule automatiquement
                // tous les joueurs sur la page de vote
                if (data.status === 'started') {
                    window.location.href = `/vote/${sessionId}`;
                }
            })
            .catch(err => {
                // Log minimal en cas d’erreur réseau ou backend
                console.error(
                    'Erreur lors du rafraîchissement des participants',
                    err
                );
            });
    }

    // ----------------------------------------------------------------
    // Démarrage du polling si un sessionId est disponible
    // ----------------------------------------------------------------
    if (sessionId) {
        refreshParticipants();               // premier appel immédiat
        setInterval(refreshParticipants, 3000); // puis toutes les 3 secondes
    }
});
