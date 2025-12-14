// static/scripts/waiting.js

/**
 * waiting.js — Salle d'attente (participants)
 * -------------------------------------------
 * Responsabilités :
 * - Lire le sessionId depuis <main class="hero" data-session-id="...">
 * - Poll /api/participants/<sessionId>
 * - Mettre à jour la liste des joueurs (si le conteneur existe)
 * - Démarrer un chrono d'attente (si présent)
 */

document.addEventListener("DOMContentLoaded", () => {
  /* ======================================================================== */
  /* 1) Session                                                               */
  /* ======================================================================== */

  const mainEl = document.querySelector("main.hero[data-session-id]");
  const sessionId = mainEl ? mainEl.dataset.sessionId : null;

  /* ======================================================================== */
  /* 2) Chrono d'attente (optionnel)                                           */
  /* ======================================================================== */

  (function startWaitingTimer() {
    const timerEl = document.getElementById("waiting-timer");
    if (!timerEl) return;

    const start = Date.now();

    setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - start) / 1000);
      const m = Math.floor(elapsedSec / 60);
      const s = elapsedSec % 60;
      timerEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(
        2,
        "0"
      )}`;
    }, 1000);
  })();

  /* ======================================================================== */
  /* 3) UI helpers (optionnels selon ta page)                                  */
  /* ======================================================================== */

  /**
   * Met à jour la liste des participants si un conteneur existe.
   * Adaptable selon ton HTML (ul/li, div, etc.)
   * @param {{participants?: Array<{name:string}>}} data
   */
  function renderParticipants(data) {
    // Essaie plusieurs IDs possibles (selon tes versions)
    const listEl =
      document.getElementById("participants-list") ||
      document.getElementById("players-list") ||
      document.getElementById("participants");

    if (!listEl) return;

    const participants = (data && data.participants) || [];

    // Nettoyage safe
    listEl.innerHTML = "";

    participants.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = p.name;
      listEl.appendChild(li);
    });
  }

  /* ======================================================================== */
  /* 4) Poll API participants                                                  */
  /* ======================================================================== */

  function refreshParticipants() {
    if (!sessionId) return;

    fetch(`/api/participants/${sessionId}`)
      .then((r) => r.json())
      .then((data) => {
        renderParticipants(data);
      })
      .catch(() => {
        // silence en prod
      });
  }

  if (sessionId) {
    refreshParticipants();
    setInterval(refreshParticipants, 3000);
  }
});
