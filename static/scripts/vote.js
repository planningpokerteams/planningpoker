/**
 * @file static/scripts/vote.js
 * @brief Script client de la page de vote (table Planning Poker).
 * @details
 * Ce script gère :
 * - le clic sur une carte et la soumission du vote
 * - l’affichage des joueurs autour de la table
 * - le polling de l’état de partie via /api/game/<sessionId>
 * - la gestion des états : waiting / started / paused / finished
 * - le calcul local (moyenne, médiane, majorités) après révélation
 * - le timer par user story (affichage + auto next pour l’organisateur)
 * - le chat (affiché surtout en cas de désaccord)
 *
 * Données globales attendues :
 * - window.GAME_CONFIG = { sessionId, currentUser, isOrganizer }
 *
 * Dépendances DOM attendues (vote.html) :
 * - .poker-card[data-value]
 * - #vote-input, #vote-form
 * - #story-text, #round-info, #poker-table, #table-status-text
 * - #reveal-button, #reveal-hint
 * - #next-button, #revote-button, #force-next-button, #resume-button
 * - #history-list, #story-timer, #game-status-text
 * - (optionnel) #export-button
 * - (optionnel) chat : #chat-button, #chat-panel, #chat-messages, #chat-input, #chat-send
 */

// -----------------------------------------------------------
// Configuration globale injectée par le template Jinja
// -----------------------------------------------------------
const { sessionId, currentUser, isOrganizer } = window.GAME_CONFIG || {};


// -----------------------------------------------------------
// Sélection des éléments du DOM (cartes, timer, boutons, etc.)
// -----------------------------------------------------------
const cards        = document.querySelectorAll(".poker-card");
const voteInput    = document.getElementById("vote-input");
const voteForm     = document.getElementById("vote-form");

const storyTextEl  = document.getElementById("story-text");
const roundInfoEl  = document.getElementById("round-info");
const pokerTable   = document.getElementById("poker-table");
const tableStatus  = document.getElementById("table-status-text");

const revealButton = document.getElementById("reveal-button");
const revealHint   = document.getElementById("reveal-hint");

const nextBtn      = document.getElementById("next-button");
const revoteBtn    = document.getElementById("revote-button");
const forceNextBtn = document.getElementById("force-next-button");
const resumeBtn    = document.getElementById("resume-button");

const historyList    = document.getElementById("history-list");
const storyTimerEl   = document.getElementById("story-timer");
const gameStatusText = document.getElementById("game-status-text");

// NOUVEAU : bouton d’export d’état JSON
const exportBtn    = document.getElementById("export-button");

// Chat
const chatButton   = document.getElementById("chat-button");
const chatPanel    = document.getElementById("chat-panel");
const chatMessages = document.getElementById("chat-messages");
const chatInput    = document.getElementById("chat-input");
const chatSend     = document.getElementById("chat-send");


// -----------------------------------------------------------
// État local côté client (mode de jeu, timer, statut partie…)
// -----------------------------------------------------------
let lastComputedResult   = null;      // Dernière estimation calculée pour la story
let lastGameMode         = "strict";  // Mode de calcul courant
let lastRoundNumber      = 1;         // Numéro de tour pour la story en cours
let timerPerStorySeconds = 0;         // Durée d’une story (secondes)
let timerStartTimestamp  = null;      // Timestamp de départ (serveur)
let lastStatus           = "waiting"; // waiting, started, paused, finished
let timeExpiredHandled   = false;     // évite plusieurs /next_story à la fin du timer


// -----------------------------------------------------------
// Helpers UI : activer / désactiver toutes les cartes
// -----------------------------------------------------------

/**
 * @brief Active ou désactive toutes les cartes de vote.
 * @param {boolean} enabled true = cliquables, false = désactivées.
 * @return {void}
 */
function setCardsEnabled(enabled) {
    cards.forEach(card => {
        card.disabled = !enabled;
        card.classList.toggle("poker-card--disabled", !enabled);
    });
}


// -----------------------------------------------------------
// Gestion du clic sur une carte (envoi du vote)
// -----------------------------------------------------------
cards.forEach(card => {
    card.addEventListener("click", () => {
        if (card.disabled) return;

        const value = card.getAttribute("data-value");

        // Visuel : une seule carte sélectionnée à la fois
        cards.forEach(c => c.classList.remove("poker-card--selected"));
        card.classList.add("poker-card--selected");

        // Envoi du vote au backend via le formulaire POST
        voteInput.value = value;
        tableStatus.textContent =
            "Ton vote est enregistré. En attente des autres joueurs.";

        voteForm.submit();
    });
});


// -----------------------------------------------------------
// Placement des joueurs autour de la table (cercle)
// -----------------------------------------------------------

/**
 * @brief Dispose les “player-seat” en cercle autour de #poker-table.
 * @details Appelé après reconstruction de la table + au resize.
 * @return {void}
 */
function layoutSeats() {
    const seats = pokerTable.querySelectorAll(".player-seat");
    if (!seats.length) return;

    const w  = pokerTable.clientWidth;
    const h  = pokerTable.clientHeight;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(cx, cy) - 70;

    seats.forEach((seat, i) => {
        const angle = (i / seats.length) * Math.PI * 2 - Math.PI / 2;
        seat.style.left = `${cx + radius * Math.cos(angle)}px`;
        seat.style.top  = `${cy + radius * Math.sin(angle)}px`;
    });
}


// -----------------------------------------------------------
// Fonctions de calcul sur les votes (moyenne, médiane, majorités…)
// -----------------------------------------------------------

/**
 * @brief Deck Planning Poker (Fibonacci simplifié).
 * @type {number[]}
 */
const PLANNING_DECK = [1, 2, 3, 5, 8, 13];

/**
 * @brief Retourne la carte du deck la plus proche d’une valeur.
 * @param {number} value Valeur numérique (moyenne/médiane).
 * @returns {number} Carte du deck la plus proche.
 */
function nearestCard(value) {
    let best = PLANNING_DECK[0];
    let bestDiff = Math.abs(value - best);
    PLANNING_DECK.forEach(v => {
        const d = Math.abs(value - v);
        if (d < bestDiff) {
            bestDiff = d;
            best     = v;
        }
    });
    return best;
}

/**
 * @brief Calcule la moyenne des votes et renvoie la carte la plus proche.
 * @param {number[]} votes Votes numériques.
 * @returns {{avg:number, card:number}} moyenne exacte + carte choisie.
 */
function computeAverage(votes) {
    const sum = votes.reduce((a, b) => a + b, 0);
    const avg = sum / votes.length;
    return { avg, card: nearestCard(avg) };
}

/**
 * @brief Calcule la médiane des votes et renvoie la carte la plus proche.
 * @param {number[]} votes Votes numériques.
 * @returns {{median:number, card:number}} médiane exacte + carte choisie.
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
 * @brief Compte les occurrences de chaque vote.
 * @param {number[]} votes Votes numériques.
 * @returns {Object<string, number>} histogramme {valeur: occurrences}.
 */
function computeCounts(votes) {
    const counts = {};
    votes.forEach(v => {
        counts[v] = (counts[v] || 0) + 1;
    });
    return counts;
}


// -----------------------------------------------------------
// Gestion du timer côté client (affichage uniquement)
// -----------------------------------------------------------

/**
 * @brief Met à jour les infos timer à partir des données backend.
 * @param {Object} data Réponse de /api/game/<sessionId>.
 * @return {void}
 */
function updateTimerFromData(data) {
    timerPerStorySeconds = (data.timePerStory || 0) * 60;
    const newStart = data.timerStart || null;
    if (newStart !== timerStartTimestamp) {
        timerStartTimestamp = newStart;
        timeExpiredHandled  = false;
    }
}

/**
 * @brief Met à jour l’affichage du timer (mm:ss) toutes les secondes.
 * @details À 0, l’organisateur déclenche automatiquement /next_story (une seule fois).
 * @return {void}
 */
function tickStoryTimer() {
    if (!storyTimerEl) return;
    const span = storyTimerEl.querySelector("span");

    if (!timerPerStorySeconds || !timerStartTimestamp || lastStatus !== "started") {
        storyTimerEl.classList.remove("timer-danger");
        span.textContent = (lastStatus === "finished") ? "FIN" : "--:--";
        return;
    }

    const now = Math.floor(Date.now() / 1000);
    let remaining = timerPerStorySeconds - (now - timerStartTimestamp);
    if (remaining < 0) remaining = 0;

    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    span.textContent =
        String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");

    if (remaining <= 60) {
        storyTimerEl.classList.add("timer-danger");
    } else {
        storyTimerEl.classList.remove("timer-danger");
    }

    if (remaining === 0 && isOrganizer && !timeExpiredHandled) {
        timeExpiredHandled = true;
        fetch(`/next_story/${sessionId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ result: lastComputedResult })
        }).then(() => refreshGameState());
    }
}

setInterval(tickStoryTimer, 1000);


// -----------------------------------------------------------
// Rafraîchissement de l’état de la partie depuis l’API backend
// -----------------------------------------------------------

/**
 * @brief Récupère l’état serveur et met à jour toute l’UI de vote.
 * @details
 * Endpoint : GET /api/game/<sessionId>
 * Gère :
 * - participants autour de la table
 * - affichage histoire + tour
 * - affichage historique
 * - pause café / fin de partie
 * - bouton révéler / next / revote / chat
 * - calcul du résultat après reveal (selon lastGameMode + round)
 * @return {void}
 */
function refreshGameState() {
    fetch(`/api/game/${sessionId}`)
        .then(r => r.json())
        .then(data => {
            if (data.error) return;

            lastGameMode    = data.gameMode || "strict";
            lastRoundNumber = data.roundNumber || 1;
            lastStatus      = data.status || "waiting";

            updateTimerFromData(data);

            if (data.currentStory) {
                storyTextEl.textContent = data.currentStory;
            }
            if (roundInfoEl) {
                roundInfoEl.textContent = `Tour ${lastRoundNumber}`;
            }

            if (gameStatusText) {
                gameStatusText.style.display = "none";
                gameStatusText.textContent   = "";
            }

            // -------------------------------
            // Historique
            // -------------------------------
            historyList.innerHTML = "";
            (data.history || []).forEach(entry => {
                const li = document.createElement("li");
                li.className = "history-item";
                const votes = entry.votes || [];

                const votesHtml = votes.map(v => `
                    <div class="history-vote">
                        <img class="history-avatar"
                             src="https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(v.avatar || "astronaut")}&backgroundColor=b6e3f4&radius=50"
                             alt="avatar ${v.name}">
                        <span class="history-voter-name">${v.name}</span>
                        <span class="history-vote-card">${v.vote ?? "—"}</span>
                    </div>
                `).join("");

                li.innerHTML = `
                    <div class="history-story">📝 ${entry.story || ""}</div>
                    <div class="history-result">
                        <span class="history-result-label">Résultat</span>
                        <span class="history-result-value">${entry.result ?? "—"}</span>
                    </div>
                    <div class="history-votes">
                        ${votesHtml}
                    </div>
                `;
                historyList.appendChild(li);
            });

            // -------------------------------
            // Joueurs autour de la table
            // -------------------------------
            pokerTable.querySelectorAll(".player-seat").forEach(n => n.remove());

            let meHasVoted = false;
            (data.participants || []).forEach(p => {
                const seat = document.createElement("div");
                seat.className = "player-seat";
                if (p.hasVoted) seat.classList.add("has-voted");

                const img = document.createElement("img");
                img.className = "player-avatar";
                img.src = `https://api.dicebear.com/9.x/avataaars/svg?seed=${p.avatarSeed || "astronaut"}`;
                seat.appendChild(img);

                const name = document.createElement("div");
                name.className = "player-name";
                name.textContent = p.name;
                seat.appendChild(name);

                const s = document.createElement("div");
                s.className = "player-status";

                if (data.reveal) {
                    seat.classList.add("revealed");
                    s.textContent =
                        (p.vote !== null && p.vote !== undefined) ? p.vote : "—";
                } else {
                    s.textContent = p.hasVoted ? "A voté" : "En attente";
                }

                seat.appendChild(s);
                pokerTable.appendChild(seat);

                if (p.name === currentUser && p.hasVoted) {
                    meHasVoted = true;
                }
            });

            layoutSeats();

            // -------------------------------
            // Pause café
            // -------------------------------
            if (data.status === "paused" && data.allCafe) {
                setCardsEnabled(false);
                tableStatus.textContent = "☕ Une pause s'impose !";

                if (gameStatusText) {
                    gameStatusText.style.display = "block";
                    gameStatusText.textContent =
                        "Tous les joueurs ont choisi la carte café, la partie est en pause.";
                }

                if (isOrganizer && resumeBtn) {
                    resumeBtn.style.display = "inline-block";
                }

                if (isOrganizer && exportBtn) {
                    exportBtn.style.display = "inline-block";
                }

                if (nextBtn)      nextBtn.style.display = "none";
                if (revoteBtn)    revoteBtn.style.display = "none";
                if (chatButton)   chatButton.style.display = 'none';
                if (forceNextBtn) forceNextBtn.style.display = "none";

                timerPerStorySeconds = 0;
                timerStartTimestamp  = null;
                return;
            } else {
                if (resumeBtn) resumeBtn.style.display = "none";
                if (exportBtn) exportBtn.style.display = "none";
            }

            // -------------------------------
            // Fin de partie
            // -------------------------------
            if (data.status === "finished") {
                setCardsEnabled(false);
                tableStatus.textContent =
                    "🎉 Partie terminée. Toutes les user stories ont été estimées.";

                if (gameStatusText) {
                    gameStatusText.style.display = "block";
                    gameStatusText.textContent =
                        "La partie est terminée, merci pour votre participation.";
                }
                if (roundInfoEl) {
                    roundInfoEl.textContent = "";
                }

                if (revealButton) revealButton.style.display = "none";
                if (nextBtn)      nextBtn.style.display = "none";
                if (revoteBtn)    revoteBtn.style.display = "none";
                if (chatButton)   chatButton.style.display = 'none';
                if (forceNextBtn) forceNextBtn.style.display = "none";

                return;
            }

            // -------------------------------
            // Partie en cours (non en pause)
            // -------------------------------
            setCardsEnabled(true);

            // ---------- Avant révélation ----------
            if (!data.reveal) {
                lastComputedResult = null;

                if (meHasVoted) {
                    if (!isOrganizer && !data.allVoted) {
                        tableStatus.textContent =
                            "Ton vote est enregistré. En attente des autres joueurs.";
                    } else if (!isOrganizer && data.allVoted) {
                        tableStatus.textContent =
                            "Tous les votes sont enregistrés. En attente que l’organisateur révèle les cartes.";
                    } else if (isOrganizer && !data.allVoted) {
                        tableStatus.textContent =
                            "Ton vote est enregistré. En attente que tout le monde vote.";
                    } else {
                        tableStatus.textContent =
                            "Tout le monde a voté, tu peux révéler les cartes.";
                    }
                } else {
                    tableStatus.textContent = "Clique sur une carte pour voter.";
                }

                if (isOrganizer && revealButton && revealHint) {
                    if (data.allVoted) {
                        revealButton.style.display = "inline-block";
                        revealButton.disabled = false;
                        revealHint.textContent =
                            "Tout le monde a voté, tu peux révéler les cartes.";
                    } else {
                        revealButton.style.display = "none";
                        revealHint.textContent = "En attente des votes…";
                    }
                }

                if (nextBtn)      nextBtn.style.display = "none";
                if (revoteBtn)    revoteBtn.style.display = "none";
                if (chatButton)   chatButton.style.display = 'none';
                if (forceNextBtn) forceNextBtn.style.display = "none";

                return;
            }

            // ---------- Après révélation ----------
            const allVotesCount = (data.participants || []).length;
            const rawVotes      = (data.participants || []).map(p => p.vote);
            const numericVotes  = rawVotes
                .map(v => parseInt(v))
                .filter(Number.isFinite);

            // Unanimité: préférer la décision backend si dispo
            let unanimity = false;
            let unanimousValue = null;
            if (typeof data.unanimous !== 'undefined') {
                unanimity = !!data.unanimous;
                unanimousValue = data.unanimousValue;
            } else {
                if (numericVotes.length === allVotesCount && allVotesCount > 0) {
                    unanimity = numericVotes.every(v => v === numericVotes[0]);
                    if (unanimity) unanimousValue = numericVotes[0];
                }
            }

            const strictModeAlways = (lastGameMode === "strict");
            const isStrictTurn     = strictModeAlways || (lastRoundNumber === 1);

            if (revealButton) revealButton.style.display = "none";
            if (revealHint) revealHint.textContent = "Les cartes sont révélées.";

            // ----- Tour strict -----
            if (isStrictTurn) {
                if (unanimity) {
                    const val = numericVotes[0];
                    lastComputedResult = val;
                    tableStatus.textContent =
                        `✅ Unanimité atteinte (mode strict) : ${val}`;
                    if (isOrganizer && nextBtn) nextBtn.style.display = "block";
                    if (revoteBtn)             revoteBtn.style.display = "none";
                    if (forceNextBtn)          forceNextBtn.style.display = "none";
                } else {
                    lastComputedResult = null;
                    tableStatus.textContent =
                        "❌ Pas d'unanimité (mode strict). Discutez et relancez un vote.";
                    if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
                    if (chatButton) chatButton.style.display = 'inline-block';
                    if (nextBtn)      nextBtn.style.display = "none";
                    if (forceNextBtn) forceNextBtn.style.display = "none";
                }
            } else {
                // ----- Modes auto -----
                if (!numericVotes.length) {
                    lastComputedResult = null;
                    tableStatus.textContent =
                        "Les joueurs n'ont pas choisi de valeur numérique (café / ?).";
                    if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
                    if (chatButton) chatButton.style.display = 'inline-block';
                    if (nextBtn)      nextBtn.style.display = "none";
                    if (forceNextBtn) forceNextBtn.style.display = "none";
                    return;
                }

                let result  = null;
                let message = "";
                let label   = "";

                if (lastGameMode === "average") {
                    label = "Moyenne";
                    const { avg, card } = computeAverage(numericVotes);
                    result  = card;
                    message = `Moyenne = ${avg.toFixed(2)} → carte la plus proche : ${card}`;
                } else if (lastGameMode === "median") {
                    label = "Médiane";
                    const { median, card } = computeMedian(numericVotes);
                    result  = card;
                    message = `Médiane = ${median} → carte la plus proche : ${card}`;
                } else if (lastGameMode === "abs") {
                    label = "Majorité absolue";
                    const counts = computeCounts(numericVotes);
                    let bestVal = null, bestCount = 0;
                    Object.keys(counts).forEach(k => {
                        const c = counts[k];
                        if (c > bestCount) {
                            bestCount = c;
                            bestVal   = parseInt(k);
                        }
                    });
                    if (bestVal !== null && bestCount > allVotesCount / 2) {
                        result  = bestVal;
                        message =
                            `Valeur ${bestVal} choisie par ${bestCount}/${allVotesCount} joueurs.`;
                    } else {
                        message =
                            "Pas de majorité absolue claire. Discutez et revotez si besoin.";
                    }
                } else if (lastGameMode === "rel") {
                    label = "Majorité relative";
                    const counts = computeCounts(numericVotes);
                    let bestVal = null, bestCount = 0, tie = false;
                    Object.keys(counts).forEach(k => {
                        const c = counts[k];
                        if (c > bestCount) {
                            bestCount = c;
                            bestVal   = parseInt(k);
                            tie       = false;
                        } else if (c === bestCount) {
                            tie = true;
                        }
                    });
                    if (bestVal !== null && !tie) {
                        result  = bestVal;
                        message =
                            `Valeur ${bestVal} majoritaire (${bestCount}/${allVotesCount} votes).`;
                    } else {
                        message =
                            "Pas de majorité relative claire (égalité). Discutez et revotez si besoin.";
                    }
                }

                if (result !== null) {
                    lastComputedResult = result;
                    tableStatus.textContent =
                        `✅ Résultat (${label}) : ${result}. ${message}`;
                    if (isOrganizer && nextBtn)   nextBtn.style.display = "block";
                    if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
                    if (chatButton) chatButton.style.display = 'inline-block';
                    if (forceNextBtn)             forceNextBtn.style.display = "none";
                } else {
                    lastComputedResult = null;
                    tableStatus.textContent = `❌ ${message}`;
                    if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
                    if (chatButton) chatButton.style.display = 'inline-block';
                    if (nextBtn)      nextBtn.style.display = "none";
                    if (forceNextBtn) forceNextBtn.style.display = "none";
                }
            }
        });
}

setInterval(refreshGameState, 2000);
refreshGameState();
window.addEventListener("resize", layoutSeats);


// -------------------------------
// Chat : polling, envoi, affichage
// -------------------------------

/**
 * @brief Échappe du texte pour éviter l’injection HTML dans le chat.
 * @param {string} s Texte source.
 * @returns {string} Texte échappé.
 */
function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>\"']/g, function (c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c];
    });
}

/**
 * @brief Affiche la liste des messages du chat dans #chat-messages.
 * @param {Array<{sender:string,text:string,ts:number}>} msgs Messages du chat.
 * @return {void}
 */
function renderChatMessages(msgs) {
    if (!chatMessages) return;
    chatMessages.innerHTML = msgs.map(m => {
        const t = new Date((m.ts || 0) * 1000).toLocaleTimeString();
        return `<div class="chat-line"><strong>${escapeHtml(m.sender)}:</strong> ${escapeHtml(m.text)} <span class="chat-ts">${t}</span></div>`;
    }).join("");
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

let lastChatFetch = 0;

/**
 * @brief Récupère les messages du chat si le panneau est visible.
 * @details Throttle à 1 requête/sec environ.
 * @return {void}
 */
function fetchChat() {
    if (!chatPanel || chatPanel.style.display === 'none') return;
    const now = Date.now();
    if (now - lastChatFetch < 1000) return;
    lastChatFetch = now;

    fetch(`/api/chat/${sessionId}`)
        .then(r => r.json())
        .then(data => {
            if (!data || !data.messages) return;
            renderChatMessages(data.messages || []);
        })
        .catch(() => {});
}

if (chatSend) {
    chatSend.addEventListener('click', () => {
        const text = chatInput && chatInput.value && chatInput.value.trim();
        if (!text) return;

        fetch(`/api/chat/${sessionId}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({text})
        })
        .then(r => {
            if (r.ok) {
                if (chatInput) chatInput.value = '';
                fetchChat();
            }
        })
        .catch(() => {});
    });

    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); chatSend.click(); }
        });
    }
}

setInterval(fetchChat, 2000);


// -----------------------------------------------------------
// Actions de l’organisateur (next story, revote, reprise pause)
// -----------------------------------------------------------
if (nextBtn) {
    nextBtn.addEventListener("click", () => {
        fetch(`/next_story/${sessionId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ result: lastComputedResult })
        }).then(() => refreshGameState());
    });
}

if (revoteBtn) {
    revoteBtn.addEventListener("click", () => {
        fetch(`/revote/${sessionId}`, { method: "POST" })
            .then(() => {
                if (chatPanel) chatPanel.style.display = 'none';
                if (chatButton) chatButton.style.display = 'none';
                refreshGameState();
            });
    });
}

if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
        fetch(`/resume/${sessionId}`, { method: "POST" })
            .then(() => refreshGameState());
    });
}

if (chatButton) {
    chatButton.addEventListener('click', () => {
        if (!chatPanel) return;
        const isHidden = chatPanel.style.display === 'none' || !chatPanel.style.display;
        chatPanel.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            fetchChat();
            if (chatInput) chatInput.focus();
        }
    });
}
