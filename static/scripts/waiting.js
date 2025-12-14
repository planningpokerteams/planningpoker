/**
 * @fileoverview
 * waiting.js — Salle d'attente (participants)
 * -------------------------------------------
 * Responsabilités :
 * - Lire le sessionId depuis <main class="hero" data-session-id="...">
 * - Poll /api/participants/<sessionId>
 * - Mettre à jour la liste des joueurs (si le conteneur existe)
 * - Démarrer un chrono d'attente (si présent)
 */

/* ========================================================================== */
/* 1) Types (JSDoc)                                                           */
/* ========================================================================== */

/**
 * Un participant minimal affichable dans la salle d'attente.
 * @typedef {Object} WaitingParticipant
 * @property {string} name - Nom/pseudo du participant
 */

/**
 * Réponse API attendue depuis /api/participants/<sessionId>.
 * (Le champ `participants` peut être absent selon backend/erreurs)
 * @typedef {Object} ParticipantsResponse
 * @property {WaitingParticipant[]} [participants] - Liste des participants
 */

/* ========================================================================== */
/* 2) Bootstrap DOMContentLoaded                                               */
/* ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  /* ======================================================================== */
  /* 2.1) Session                                                             */
  /* ======================================================================== */

  /** @type {HTMLElement|null} */
  const mainEl = document.querySelector("main.hero[data-session-id]");

  /** @type {string|null} */
  const sessionId = mainEl ? mainEl.dataset.sessionId || null : null;

  /* ======================================================================== */
  /* 2.2) Chrono d'attente (optionnel)                                         */
  /* ======================================================================== */

  /**
   * Lance un chrono mm:ss si l'élément #waiting-timer existe.
   * @returns {void}
   */
  function startWaitingTimer() {
    /** @type {HTMLElement|null} */
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
  }

  startWaitingTimer();

  /* ======================================================================== */
  /* 2.3) UI helpers                                                          */
  /* ======================================================================== */

  /**
   * Cherche un conteneur de liste participants selon plusieurs IDs possibles.
   * @returns {HTMLElement|null}
   */
  function getParticipantsListEl() {
    return (
      document.getElementById("participants-list") ||
      document.getElementById("players-list") ||
      document.getElementById("participants")
    );
  }

  /**
   * Met à jour la liste des participants si un conteneur existe.
   * @param {ParticipantsResponse} data
   * @returns {void}
   */
  function renderParticipants(data) {
    const listEl = getParticipantsListEl();
    if (!listEl) return;

    const participants = (data && data.participants) ? data.participants : [];

    // Nettoyage safe
    listEl.innerHTML = "";

    participants.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = p.name;
      listEl.appendChild(li);
    });
  }

  /* ======================================================================== */
  /* 2.4) Poll API                                                            */
  /* ======================================================================== */

  /**
   * Récupère la liste des participants via GET /api/participants/<sessionId>.
   * @returns {void}
   */
  function refreshParticipants() {
    if (!sessionId) return;

    fetch(`/api/participants/${sessionId}`)
      .then((r) => r.json())
      .then((/** @type {ParticipantsResponse} */ data) => {
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
