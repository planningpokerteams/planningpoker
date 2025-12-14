/**
 * vote.js — Gestion de la page de vote (Planning Poker)
 * -----------------------------------------------------
 * Responsabilités :
 * - Gestion du vote (clic carte → submit form)
 * - Récupération régulière de l’état de partie (polling API)
 * - Affichage de la table (joueurs en cercle + statuts + reveal)
 * - Calculs locaux (moyenne / médiane / majorités) si besoin
 * - Timer visuel + auto-next pour l’organisateur
 * - Chat (polling + envoi) piloté par l’état de la partie
 *
 * Dépendances HTML (IDs/classes attendus) :
 * - .poker-card[data-value]
 * - #vote-form, #vote-input
 * - #story-text, #round-info, #poker-table, #table-status-text
 * - #reveal-button, #reveal-hint
 * - #next-button, #revote-button, #force-next-button, #resume-button
 * - #history-list, #story-timer > span, #game-status-text
 * - #export-button
 * - #chat-button, #chat-panel, #chat-messages, #chat-input, #chat-send
 */

/* ========================================================================== */
/* 1) Types (JSDoc)                                                           */
/* ========================================================================== */

/**
 * @typedef {Object} GameConfig
 * @property {string} sessionId
 * @property {string} currentUser
 * @property {boolean} isOrganizer
 */

/**
 * @typedef {"waiting"|"started"|"paused"|"finished"} GameStatus
 */

/**
 * @typedef {Object} Participant
 * @property {string} name
 * @property {string} avatarSeed
 * @property {string|null} vote
 * @property {boolean} hasVoted
 */

/**
 * @typedef {Object} HistoryVoteEntry
 * @property {string} name
 * @property {string} avatar
 * @property {string|null} vote
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {string} story
 * @property {number|string|null} result
 * @property {HistoryVoteEntry[]} votes
 */

/**
 * @typedef {Object} GameState
 * @property {GameStatus} status
 * @property {"strict"|"average"|"median"|"abs"|"rel"} gameMode
 * @property {number} roundNumber
 * @property {string|null} currentStory
 * @property {boolean} reveal
 * @property {Participant[]} participants
 * @property {HistoryEntry[]} history
 * @property {number} timePerStory
 * @property {number|null} timerStart
 * @property {boolean} [allVoted]
 * @property {boolean} [allCafe]
 * @property {boolean} [unanimous]
 * @property {number|null} [unanimousValue]
 * @property {string} [error]
 */

/**
 * @typedef {Object} ChatMessage
 * @property {string} sender
 * @property {string} text
 * @property {number} ts
 */

/* ========================================================================== */
/* 2) Configuration globale (injectée par Jinja)                              */
/* ========================================================================== */

/** @type {GameConfig} */
const { sessionId, currentUser, isOrganizer } = window.GAME_CONFIG || {};

/* ========================================================================== */
/* 3) Sélection des éléments DOM                                              */
/* ========================================================================== */

const cards = document.querySelectorAll(".poker-card");
const voteInput = document.getElementById("vote-input");
const voteForm = document.getElementById("vote-form");

const storyTextEl = document.getElementById("story-text");
const roundInfoEl = document.getElementById("round-info");
const pokerTable = document.getElementById("poker-table");
const tableStatus = document.getElementById("table-status-text");

const revealButton = document.getElementById("reveal-button");
const revealHint = document.getElementById("reveal-hint");

const nextBtn = document.getElementById("next-button");
const revoteBtn = document.getElementById("revote-button");
const forceNextBtn = document.getElementById("force-next-button");
const resumeBtn = document.getElementById("resume-button");

const historyList = document.getElementById("history-list");
const storyTimerEl = document.getElementById("story-timer");
const gameStatusText = document.getElementById("game-status-text");

const exportBtn = document.getElementById("export-button");

const chatButton = document.getElementById("chat-button");
const chatPanel = document.getElementById("chat-panel");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");

/* ========================================================================== */
/* 4) État local côté client                                                  */
/* ========================================================================== */

/** @type {number|string|null} */
let lastComputedResult = null;
// Dernière estimation calculée pour la story

/** @type {"strict"|"average"|"median"|"abs"|"rel"} */
let lastGameMode = "strict";
// Mode de calcul courant

/** @type {number} */
let lastRoundNumber = 1;
// Numéro de tour courant

/** @type {number} */
let timerPerStorySeconds = 0;
// Durée de la story en secondes

/** @type {number|null} */
let timerStartTimestamp = null;
// Timestamp serveur (secondes)

/** @type {GameStatus} */
let lastStatus = "waiting";
// Statut de session

/** @type {boolean} */
let timeExpiredHandled = false;
// Anti-double appel /next_story à la fin du timer

/* ========================================================================== */
/* 5) Helpers UI                                                              */
/* ========================================================================== */

/**
 * Active/désactive toutes les cartes de vote.
 * @param {boolean} enabled
 */
function setCardsEnabled(enabled) {
  cards.forEach((card) => {
    card.disabled = !enabled;
    card.classList.toggle("poker-card--disabled", !enabled);
  });
}

/**
 * Place les sièges (.player-seat) en cercle autour de la table.
 */
function layoutSeats() {
  if (!pokerTable) return;

  const seats = pokerTable.querySelectorAll(".player-seat");
  if (!seats.length) return;

  const w = pokerTable.clientWidth;
  const h = pokerTable.clientHeight;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy) - 70;

  seats.forEach((seat, i) => {
    const angle = (i / seats.length) * Math.PI * 2 - Math.PI / 2;
    seat.style.left = `${cx + radius * Math.cos(angle)}px`;
    seat.style.top = `${cy + radius * Math.sin(angle)}px`;
  });
}

/* ========================================================================== */
/* 6) Vote — clic sur une carte                                                */
/* ========================================================================== */

cards.forEach((card) => {
  card.addEventListener("click", () => {
    if (card.disabled) return;

    const value = card.getAttribute("data-value");
    if (!value) return;

    cards.forEach((c) => c.classList.remove("poker-card--selected"));
    card.classList.add("poker-card--selected");

    if (voteInput) voteInput.value = value;
    if (tableStatus) {
      tableStatus.textContent = "Ton vote est enregistré. En attente des autres joueurs.";
    }

    if (voteForm) voteForm.submit();
  });
});

/* ========================================================================== */
/* 7) Calculs locaux (moyenne / médiane / majorités)                           */
/* ========================================================================== */

/** @type {number[]} */
const PLANNING_DECK = [1, 2, 3, 5, 8, 13];

/**
 * @param {number} value
 * @returns {number}
 */
function nearestCard(value) {
  let best = PLANNING_DECK[0];
  let bestDiff = Math.abs(value - best);

  PLANNING_DECK.forEach((v) => {
    const d = Math.abs(value - v);
    if (d < bestDiff) {
      bestDiff = d;
      best = v;
    }
  });

  return best;
}

/**
 * @param {number[]} votes
 * @returns {{avg:number, card:number}}
 */
function computeAverage(votes) {
  const sum = votes.reduce((a, b) => a + b, 0);
  const avg = sum / votes.length;
  return { avg, card: nearestCard(avg) };
}

/**
 * @param {number[]} votes
 * @returns {{median:number, card:number}}
 */
function computeMedian(votes) {
  const sorted = [...votes].sort((a, b) => a - b);

  let median;
  if (sorted.length % 2 === 1) {
    median = sorted[(sorted.length - 1) / 2];
  } else {
    median = (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  }

  return { median, card: nearestCard(median) };
}

/**
 * @param {number[]} votes
 * @returns {Record<string, number>}
 */
function computeCounts(votes) {
  /** @type {Record<string, number>} */
  const counts = {};
  votes.forEach((v) => {
    counts[v] = (counts[v] || 0) + 1;
  });
  return counts;
}

/* ========================================================================== */
/* 8) Timer (affichage côté client)                                            */
/* ========================================================================== */

/**
 * @param {GameState} data
 */
function updateTimerFromData(data) {
  timerPerStorySeconds = (data.timePerStory || 0) * 60;

  const newStart = data.timerStart || null;
  if (newStart !== timerStartTimestamp) {
    timerStartTimestamp = newStart;
    timeExpiredHandled = false;
  }
}

function tickStoryTimer() {
  if (!storyTimerEl) return;
  const span = storyTimerEl.querySelector("span");
  if (!span) return;

  if (!timerPerStorySeconds || !timerStartTimestamp || lastStatus !== "started") {
    storyTimerEl.classList.remove("timer-danger");
    span.textContent = lastStatus === "finished" ? "FIN" : "--:--";
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  let remaining = timerPerStorySeconds - (now - timerStartTimestamp);
  if (remaining < 0) remaining = 0;

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;

  span.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  if (remaining <= 60) storyTimerEl.classList.add("timer-danger");
  else storyTimerEl.classList.remove("timer-danger");

  if (remaining === 0 && isOrganizer && !timeExpiredHandled) {
    timeExpiredHandled = true;
    fetch(`/next_story/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: lastComputedResult }),
    }).then(() => refreshGameState());
  }
}

setInterval(tickStoryTimer, 1000);

/* ========================================================================== */
/* 9) Rafraîchissement de l'état de partie                                     */
/* ========================================================================== */

function dicebearUrl(seed, withBg = false) {
  const s = encodeURIComponent(seed || "astronaut");
  const bg = withBg ? "&backgroundColor=b6e3f4&radius=50" : "";
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${s}${bg}`;
}

function refreshGameState() {
  if (!sessionId) return;

  fetch(`/api/game/${sessionId}`)
    .then((r) => r.json())
    .then((/** @type {GameState} */ data) => {
      if (!data || data.error) return;

      lastGameMode = data.gameMode || "strict";
      lastRoundNumber = data.roundNumber || 1;
      lastStatus = data.status || "waiting";

      updateTimerFromData(data);

      if (storyTextEl && data.currentStory) storyTextEl.textContent = data.currentStory;
      if (roundInfoEl) roundInfoEl.textContent = `Tour ${lastRoundNumber}`;

      if (gameStatusText) {
        gameStatusText.style.display = "none";
        gameStatusText.textContent = "";
      }

      // Historique (garde anti-null)
      if (historyList) {
        historyList.innerHTML = "";
        (data.history || []).forEach((entry) => {
          const li = document.createElement("li");
          li.className = "history-item";

          const votes = entry.votes || [];
          const votesHtml = votes
            .map(
              (v) => `
                <div class="history-vote">
                  <img class="history-avatar"
                       src="${dicebearUrl(v.avatar || "astronaut", true)}"
                       alt="avatar ${escapeHtml(v.name)}">
                  <span class="history-voter-name">${escapeHtml(v.name)}</span>
                  <span class="history-vote-card">${v.vote ?? "—"}</span>
                </div>
              `
            )
            .join("");

          li.innerHTML = `
            <div class="history-story">📝 ${escapeHtml(entry.story || "")}</div>
            <div class="history-result">
              <span class="history-result-label">Résultat</span>
              <span class="history-result-value">${entry.result ?? "—"}</span>
            </div>
            <div class="history-votes">${votesHtml}</div>
          `;

          historyList.appendChild(li);
        });
      }

      if (pokerTable) {
        pokerTable.querySelectorAll(".player-seat").forEach((n) => n.remove());

        let meHasVoted = false;

        (data.participants || []).forEach((p) => {
          const seat = document.createElement("div");
          seat.className = "player-seat";
          if (p.hasVoted) seat.classList.add("has-voted");

          const img = document.createElement("img");
          img.className = "player-avatar";
          img.src = dicebearUrl(p.avatarSeed || "astronaut");
          seat.appendChild(img);

          const name = document.createElement("div");
          name.className = "player-name";
          name.textContent = p.name;
          seat.appendChild(name);

          const s = document.createElement("div");
          s.className = "player-status";

          if (data.reveal) {
            seat.classList.add("revealed");
            s.textContent = p.vote !== null && p.vote !== undefined ? String(p.vote) : "—";
          } else {
            s.textContent = p.hasVoted ? "A voté" : "En attente";
          }

          seat.appendChild(s);
          pokerTable.appendChild(seat);

          if (p.name === currentUser && p.hasVoted) meHasVoted = true;
        });

        layoutSeats();

        // Pause café
        if (data.status === "paused" && data.allCafe) {
          setCardsEnabled(false);
          if (tableStatus) tableStatus.textContent = "☕ Une pause s'impose !";

          if (gameStatusText) {
            gameStatusText.style.display = "block";
            gameStatusText.textContent =
              "Tous les joueurs ont choisi la carte café, la partie est en pause.";
          }

          if (isOrganizer && resumeBtn) resumeBtn.style.display = "inline-block";
          if (isOrganizer && exportBtn) exportBtn.style.display = "inline-block";

          if (nextBtn) nextBtn.style.display = "none";
          if (revoteBtn) revoteBtn.style.display = "none";
          if (chatButton) chatButton.style.display = "none";
          if (forceNextBtn) forceNextBtn.style.display = "none";

          timerPerStorySeconds = 0;
          timerStartTimestamp = null;
          return;
        } else {
          if (resumeBtn) resumeBtn.style.display = "none";
          if (exportBtn) exportBtn.style.display = "none";
        }

        // Fin de partie
        if (data.status === "finished") {
          setCardsEnabled(false);

          if (tableStatus) {
            tableStatus.textContent =
              "🎉 Partie terminée. Toutes les user stories ont été estimées.";
          }

          if (gameStatusText) {
            gameStatusText.style.display = "block";
            gameStatusText.textContent =
              "La partie est terminée, merci pour votre participation.";
          }

          if (roundInfoEl) roundInfoEl.textContent = "";

          if (revealButton) revealButton.style.display = "none";
          if (nextBtn) nextBtn.style.display = "none";
          if (revoteBtn) revoteBtn.style.display = "none";
          if (chatButton) chatButton.style.display = "none";
          if (forceNextBtn) forceNextBtn.style.display = "none";
          return;
        }

        setCardsEnabled(true);

        // Avant reveal
        if (!data.reveal) {
          lastComputedResult = null;

          if (tableStatus) {
            if (meHasVoted) {
              if (!isOrganizer && !data.allVoted) {
                tableStatus.textContent = "Ton vote est enregistré. En attente des autres joueurs.";
              } else if (!isOrganizer && data.allVoted) {
                tableStatus.textContent =
                  "Tous les votes sont enregistrés. En attente que l’organisateur révèle les cartes.";
              } else if (isOrganizer && !data.allVoted) {
                tableStatus.textContent = "Ton vote est enregistré. En attente que tout le monde vote.";
              } else {
                tableStatus.textContent = "Tout le monde a voté, tu peux révéler les cartes.";
              }
            } else {
              tableStatus.textContent = "Clique sur une carte pour voter.";
            }
          }

          if (isOrganizer && revealButton && revealHint) {
            if (data.allVoted) {
              revealButton.style.display = "inline-block";
              revealButton.disabled = false;
              revealHint.textContent = "Tout le monde a voté, tu peux révéler les cartes.";
            } else {
              revealButton.style.display = "none";
              revealHint.textContent = "En attente des votes…";
            }
          }

          if (nextBtn) nextBtn.style.display = "none";
          if (revoteBtn) revoteBtn.style.display = "none";
          if (chatButton) chatButton.style.display = "none";
          if (forceNextBtn) forceNextBtn.style.display = "none";
          return;
        }

        // Après reveal
        const allVotesCount = (data.participants || []).length;
        const rawVotes = (data.participants || []).map((p) => p.vote);
        const numericVotes = rawVotes
          .map((v) => parseInt(String(v), 10))
          .filter(Number.isFinite);

        let unanimity = false;
        let unanimousValue = null;

        if (typeof data.unanimous !== "undefined") {
          unanimity = !!data.unanimous;
          unanimousValue = data.unanimousValue ?? null;
        } else {
          if (numericVotes.length === allVotesCount && allVotesCount > 0) {
            unanimity = numericVotes.every((v) => v === numericVotes[0]);
            if (unanimity) unanimousValue = numericVotes[0];
          }
        }

        const strictModeAlways = lastGameMode === "strict";
        const isStrictTurn = strictModeAlways || lastRoundNumber === 1;

        if (revealButton) revealButton.style.display = "none";
        if (revealHint) revealHint.textContent = "Les cartes sont révélées.";

        if (isStrictTurn) {
          if (unanimity && numericVotes.length) {
            const val = numericVotes[0];
            lastComputedResult = val;

            if (tableStatus) tableStatus.textContent = `✅ Unanimité atteinte (mode strict) : ${val}`;
            if (isOrganizer && nextBtn) nextBtn.style.display = "block";
            if (revoteBtn) revoteBtn.style.display = "none";
            if (forceNextBtn) forceNextBtn.style.display = "none";
          } else {
            lastComputedResult = null;

            if (tableStatus) {
              tableStatus.textContent =
                "❌ Pas d'unanimité (mode strict). Discutez et relancez un vote.";
            }

            if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
            if (chatButton) chatButton.style.display = "inline-block";
            if (nextBtn) nextBtn.style.display = "none";
            if (forceNextBtn) forceNextBtn.style.display = "none";
          }
          return;
        }

        if (!numericVotes.length) {
          lastComputedResult = null;

          if (tableStatus) {
            tableStatus.textContent = "Les joueurs n'ont pas choisi de valeur numérique (café / ?).";
          }

          if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
          if (chatButton) chatButton.style.display = "inline-block";
          if (nextBtn) nextBtn.style.display = "none";
          if (forceNextBtn) forceNextBtn.style.display = "none";
          return;
        }

        let result = null;
        let message = "";
        let label = "";

        if (lastGameMode === "average") {
          label = "Moyenne";
          const { avg, card } = computeAverage(numericVotes);
          result = card;
          message = `Moyenne = ${avg.toFixed(2)} → carte la plus proche : ${card}`;
        } else if (lastGameMode === "median") {
          label = "Médiane";
          const { median, card } = computeMedian(numericVotes);
          result = card;
          message = `Médiane = ${median} → carte la plus proche : ${card}`;
        } else if (lastGameMode === "abs") {
          label = "Majorité absolue";
          const counts = computeCounts(numericVotes);

          let bestVal = null;
          let bestCount = 0;

          Object.keys(counts).forEach((k) => {
            const c = counts[k];
            if (c > bestCount) {
              bestCount = c;
              bestVal = parseInt(k, 10);
            }
          });

          if (bestVal !== null && bestCount > allVotesCount / 2) {
            result = bestVal;
            message = `Valeur ${bestVal} choisie par ${bestCount}/${allVotesCount} joueurs.`;
          } else {
            message = "Pas de majorité absolue claire. Discutez et revotez si besoin.";
          }
        } else if (lastGameMode === "rel") {
          label = "Majorité relative";
          const counts = computeCounts(numericVotes);

          let bestVal = null;
          let bestCount = 0;
          let tie = false;

          Object.keys(counts).forEach((k) => {
            const c = counts[k];
            if (c > bestCount) {
              bestCount = c;
              bestVal = parseInt(k, 10);
              tie = false;
            } else if (c === bestCount) {
              tie = true;
            }
          });

          if (bestVal !== null && !tie) {
            result = bestVal;
            message = `Valeur ${bestVal} majoritaire (${bestCount}/${allVotesCount} votes).`;
          } else {
            message = "Pas de majorité relative claire (égalité). Discutez et revotez si besoin.";
          }
        }

        if (result !== null) {
          lastComputedResult = result;

          if (tableStatus) {
            tableStatus.textContent = `✅ Résultat (${label}) : ${result}. ${message}`;
          }

          if (isOrganizer && nextBtn) nextBtn.style.display = "block";
          if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
          if (chatButton) chatButton.style.display = "inline-block";
          if (forceNextBtn) forceNextBtn.style.display = "none";
        } else {
          lastComputedResult = null;

          if (tableStatus) tableStatus.textContent = `❌ ${message}`;

          if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
          if (chatButton) chatButton.style.display = "inline-block";
          if (nextBtn) nextBtn.style.display = "none";
          if (forceNextBtn) forceNextBtn.style.display = "none";
        }
      }
    })
    .catch(() => {});
}

setInterval(refreshGameState, 2000);
refreshGameState();
window.addEventListener("resize", layoutSeats);

/* ========================================================================== */
/* 10) Chat : rendu, sécurité HTML, polling, envoi                             */
/* ========================================================================== */

function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/[&<>\"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function renderChatMessages(msgs) {
  if (!chatMessages) return;

  chatMessages.innerHTML = (msgs || [])
    .map((m) => {
      const t = new Date((m.ts || 0) * 1000).toLocaleTimeString();
      return `
        <div class="chat-line">
          <strong>${escapeHtml(m.sender)}:</strong>
          ${escapeHtml(m.text)}
          <span class="chat-ts">${t}</span>
        </div>
      `;
    })
    .join("");

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/** @type {number} */
let lastChatFetch = 0;

function fetchChat() {
  if (!sessionId) return;
  if (!chatPanel || chatPanel.style.display === "none") return;

  const now = Date.now();
  if (now - lastChatFetch < 1000) return;
  lastChatFetch = now;

  fetch(`/api/chat/${sessionId}`)
    .then((r) => r.json())
    .then((data) => {
      if (!data || !data.messages) return;
      renderChatMessages(data.messages || []);
    })
    .catch(() => {});
}

setInterval(fetchChat, 2000);

function sendChatMessage(text) {
  if (!sessionId) return Promise.resolve();

  return fetch(`/api/chat/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
    .then((r) => {
      if (!r.ok) return;
      if (chatInput) chatInput.value = "";
      fetchChat();
    })
    .catch(() => {});
}

if (chatSend) {
  chatSend.addEventListener("click", () => {
    const text = chatInput && chatInput.value && chatInput.value.trim();
    if (!text) return;
    sendChatMessage(text);
  });

  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        chatSend.click();
      }
    });
  }
}

/* ========================================================================== */
/* 11) Actions organisateur : next story / revote / resume                     */
/* ========================================================================== */

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    fetch(`/next_story/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: lastComputedResult }),
    }).then(() => refreshGameState());
  });
}

if (revoteBtn) {
  revoteBtn.addEventListener("click", () => {
    fetch(`/revote/${sessionId}`, { method: "POST" }).then(() => {
      if (chatPanel) chatPanel.style.display = "none";
      if (chatButton) chatButton.style.display = "none";
      refreshGameState();
    });
  });
}

if (resumeBtn) {
  resumeBtn.addEventListener("click", () => {
    fetch(`/resume/${sessionId}`, { method: "POST" }).then(() => refreshGameState());
  });
}

/* ========================================================================== */
/* 12) UI Chat : ouverture/fermeture                                          */
/* ========================================================================== */

if (chatButton) {
  chatButton.addEventListener("click", () => {
    if (!chatPanel) return;
    const isHidden = chatPanel.style.display === "none" || !chatPanel.style.display;
    chatPanel.style.display = isHidden ? "block" : "none";

    if (isHidden) {
      fetchChat();
      if (chatInput) chatInput.focus();
    }
  });
}
