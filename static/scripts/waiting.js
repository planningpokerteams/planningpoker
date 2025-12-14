/**
 * @file static/scripts/waiting.js
 * @brief Script client de la salle d’attente.
 * @details
 * Fonctionnalités :
 * - lit le sessionId depuis <main class="hero" data-session-id="...">
 * - lance un chrono d’attente (temps écoulé) dans #waiting-timer
 * - poll régulièrement /api/participants/<sessionId>
 * - affiche la liste des participants (avatar + nom) dans #participants-list
 * - redirige automatiquement vers /vote/<sessionId> quand status = "started"
 *
 * Dépendances DOM attendues (waiting.html) :
 * - main.hero[data-session-id]
 * - #waiting-timer > span (optionnel)
 * - #participants-list
 */

document.addEventListener('DOMContentLoaded', () => {
    // ----------------------------------------------------------------
    // Récupération du sessionId depuis data-session-id
    // ----------------------------------------------------------------
    const mainEl = document.querySelector('main.hero[data-session-id]');
    const sessionId = mainEl ? mainEl.dataset.sessionId : null;

    // ----------------------------------------------------------------
    // Chronomètre d'attente (temps écoulé)
    // ----------------------------------------------------------------

    /**
     * @brief Démarre un timer local (mm:ss) affiché dans #waiting-timer.
     * @details
     * Le chrono est purement côté client (pas synchronisé serveur),
     * utile pour donner un feedback “vous êtes dans la salle depuis…”.
     * @return {void}
     */
    (function startWaitingTimer() {
        const timerEl = document.getElementById('waiting-timer');
        if (!timerEl) return;

        const span = timerEl.querySelector('span');
        let elapsedSeconds = 0;

        /**
         * @brief Formate une durée en secondes vers "mm:ss".
         * @param {number} totalSeconds Durée totale en secondes.
         * @returns {string} Chaîne au format "mm:ss".
         */
        function formatTime(totalSeconds) {
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return (
                String(minutes).padStart(2, '0') +
                ':' +
                String(seconds).padStart(2, '0')
            );
        }

        // Affichage initial
        span.textContent = formatTime(elapsedSeconds);

        // Tick toutes les secondes
        setInterval(() => {
            elapsedSeconds++;
            span.textContent = formatTime(elapsedSeconds);
        }, 1000);
    })();

    // ----------------------------------------------------------------
    // Poll participants + redirection au démarrage
    // ----------------------------------------------------------------

    /**
     * @brief Récupère les participants via l’API et met à jour le DOM.
     * @details
     * Appelle GET /api/participants/<sessionId> et :
     * - reconstruit #participants-list
     * - redirige vers /vote/<sessionId> si la partie a démarré
     * @return {void}
     */
    function refreshParticipants() {
        if (!sessionId) return;

        fetch(`/api/participants/${sessionId}`)
            .then(response => response.json())
            .then(data => {
                const ul = document.getElementById('participants-list');
                if (!ul) return;

                ul.innerHTML = "";

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

                if (data.status === 'started') {
                    window.location.href = `/vote/${sessionId}`;
                }
            })
            .catch(err => {
                console.error(
                    'Erreur lors du rafraîchissement des participants',
                    err
                );
            });
    }

    // ----------------------------------------------------------------
    // Démarrage du polling
    // ----------------------------------------------------------------
    if (sessionId) {
        refreshParticipants();
        setInterval(refreshParticipants, 3000);
    }
});
