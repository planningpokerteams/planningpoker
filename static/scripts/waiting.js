/**
 * @fileoverview
 * waiting.js — Salle d'attente (participants)
 * -------------------------------------------
 * Responsabilités :
 * - Lire le sessionId depuis <main class="hero" data-session-id="...">
 * - Poll /api/participants/<sessionId>
 * - Mettre à jour la liste des joueurs (avec avatars)
 * - Rediriger automatiquement vers /vote/<sessionId> quand status === "started"
 * - Démarrer un chrono d'attente (optionnel)
 */

/* ========================================================================== */
/* 1) Types (JSDoc)                                                           */
/* ========================================================================== */

/**
 * Un participant affichable dans la salle d'attente.
 * @typedef {Object} WaitingParticipant
 * @property {string} name - Nom/pseudo du participant
 * @property {string} [avatarSeed] - Seed DiceBear pour l'avatar
 */

/**
 * Réponse API attendue depuis /api/participants/<sessionId>.
 * @typedef {Object} ParticipantsResponse
 * @property {WaitingParticipant[]} [participants] - Liste des participants
 * @property {string} [status] - waiting | started | paused | finished
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

  if (!sessionId) return;

  /* ======================================================================== */
  /* 2.2) Chrono d'attente (optionnel)                                         */
  /* ======================================================================== */

  /**
   * Lance un chrono mm:ss si l'élément #waiting-timer existe.
   * NOTE: ton HTML contient <div id="waiting-timer"> qui a déjà un <span>,
   * donc ici on met directement le texte dans l'élément.
   * @returns {void}
   */
/**
 * @brief Fonction `startWaitingTimer`.
 *
 * @returns {*} 
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

      timerEl.textContent = `⏱️ ${String(m).padStart(2, "0")}:${String(s).padStart(
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
   * Cherche le conteneur de liste participants.
   * @returns {HTMLElement|null}
   */
/**
 * @brief Fonction `getParticipantsListEl`.
 *
 * @returns {*} 
 */
  function getParticipantsListEl() {
    return (
      document.getElementById("participants-list") ||
      document.getElementById("players-list") ||
      document.getElementById("participants")
    );
  }

  /**
   * Construit l'URL DiceBear pour un seed donné.
   * @param {string} seed
   * @returns {string}
   */
/**
 * @brief Fonction `dicebearUrl`.
 * @param {*} seed
 * @returns {*} 
 */
  function dicebearUrl(seed) {
    const safeSeed = encodeURIComponent(seed || "astronaut");
    return `https://api.dicebear.com/9.x/avataaars/svg?seed=${safeSeed}&backgroundColor=b6e3f4&radius=50`;
  }

  /**
   * Met à jour la liste des participants (avec avatars).
   * @param {ParticipantsResponse} data
   * @returns {void}
   */
/**
 * @brief Fonction `renderParticipants`.
 * @param {*} data
 * @returns {*} 
 */
  function renderParticipants(data) {
    const listEl = getParticipantsListEl();
    if (!listEl) return;

    const participants = data && Array.isArray(data.participants) ? data.participants : [];

    // Nettoyage
    listEl.innerHTML = "";

    participants.forEach((p) => {
      const li = document.createElement("li");
      li.className = "participant-item";

      const img = document.createElement("img");
      img.className = "avatar-icon";
      img.alt = `avatar ${p.name || ""}`;
      img.src = dicebearUrl(p.avatarSeed || "astronaut");

      const nameSpan = document.createElement("span");
      nameSpan.textContent = p.name || "Joueur";

      li.appendChild(img);
      li.appendChild(nameSpan);
      listEl.appendChild(li);
    });
  }

  /**
   * Redirige vers la page de vote si la partie a démarré.
   * @param {ParticipantsResponse} data
   * @returns {void}
   */
/**
 * @brief Fonction `maybeRedirectToVote`.
 * @param {*} data
 * @returns {*} 
 */
  function maybeRedirectToVote(data) {
    const status = data && data.status ? String(data.status) : "waiting";
    if (status === "started") {
      // Evite boucle / double redirect
      const target = `/vote/${sessionId}`;
      if (window.location.pathname !== target) {
        window.location.href = target;
      }
    }

    // Optionnel : si tu veux rediriger aussi en paused (pour voir l’état)
    // if (status === "paused") window.location.href = `/vote/${sessionId}`;
  }

  /* ======================================================================== */
  /* 2.4) Poll API                                                            */
  /* ======================================================================== */

  /**
   * Poll /api/participants/<sessionId> et met à jour l'UI.
   * @returns {void}
   */
/**
 * @brief Fonction `refreshParticipants`.
 *
 * @returns {*} 
 */
  function refreshParticipants() {
    fetch(`/api/participants/${sessionId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((/** @type {ParticipantsResponse} */ data) => {
        renderParticipants(data);
        maybeRedirectToVote(data);
      })
      .catch(() => {
        // silence en prod
      });
  }

  refreshParticipants();
  setInterval(refreshParticipants, 2000); // un peu plus réactif que 3000
});
