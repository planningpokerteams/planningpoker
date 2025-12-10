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

// -----------------------------------------------------------
// État local côté client (mode de jeu, timer, statut partie…)
// -----------------------------------------------------------
let lastComputedResult   = null;      // Dernière estimation calculée pour la story
let lastGameMode         = "strict";  // Mode de calcul courant (strict, moyenne, etc.)
let lastRoundNumber      = 1;         // Numéro de tour pour la story en cours
let timerPerStorySeconds = 0;         // Durée d’une story en secondes
let timerStartTimestamp  = null;      // Timestamp de départ du timer (côté serveur)
let lastStatus           = "waiting"; // Statut courant de la session (waiting, started, paused, finished)
let timeExpiredHandled   = false;     // Flag pour éviter plusieurs appels /next_story sur la même fin de timer

// -----------------------------------------------------------
// Helpers UI : activer / désactiver toutes les cartes
// -----------------------------------------------------------
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
        if (card.disabled) return; // Protection si la partie est en pause / fin

        const value = card.getAttribute("data-value");

        // Visuel : une seule carte sélectionnée à la fois
        cards.forEach(c => c.classList.remove("poker-card--selected"));
        card.classList.add("poker-card--selected");

        // Envoie du vote au backend via le formulaire POST
        voteInput.value = value;
        tableStatus.textContent =
            "Ton vote est enregistré. En attente des autres joueurs.";

        voteForm.submit();
    });
});

// -----------------------------------------------------------
// Placement des joueurs autour de la table (cercle)
// -----------------------------------------------------------
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
const PLANNING_DECK = [1, 2, 3, 5, 8, 13]; // Deck Fibonacci simplifié

// Retourne la carte du deck la plus proche d’une valeur numérique
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

// Calcul de la moyenne + choix de la carte la plus proche
function computeAverage(votes) {
    const sum = votes.reduce((a, b) => a + b, 0);
    const avg = sum / votes.length;
    return { avg, card: nearestCard(avg) };
}

// Calcul de la médiane + carte la plus proche
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

// Compte combien de fois chaque valeur apparaît
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

// Met à jour la durée totale et le point de départ du timer
function updateTimerFromData(data) {
    timerPerStorySeconds = (data.timePerStory || 0) * 60;
    const newStart = data.timerStart || null;
    if (newStart !== timerStartTimestamp) {
        timerStartTimestamp = newStart;
        timeExpiredHandled  = false; // nouveau départ de chrono
    }
}

// Met à jour l’affichage du timer toutes les secondes
function tickStoryTimer() {
    if (!storyTimerEl) return;
    const span = storyTimerEl.querySelector("span");

    // Pas de timer ou partie non en cours
    if (!timerPerStorySeconds || !timerStartTimestamp || lastStatus !== "started") {
        storyTimerEl.classList.remove("timer-danger");
        span.textContent = (lastStatus === "finished") ? "FIN" : "--:--";
        return;
    }

    // Calcul du temps restant en secondes
    const now = Math.floor(Date.now() / 1000);
    let remaining = timerPerStorySeconds - (now - timerStartTimestamp);
    if (remaining < 0) remaining = 0;

    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    span.textContent =
        String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");

    // Style “danger” sur la dernière minute
    if (remaining <= 60) {
        storyTimerEl.classList.add("timer-danger");
    } else {
        storyTimerEl.classList.remove("timer-danger");
    }

    // À 0, l’organisateur passe automatiquement à la story suivante
    if (remaining === 0 && isOrganizer && !timeExpiredHandled) {
        timeExpiredHandled = true;
        fetch(`/next_story/${sessionId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ result: lastComputedResult })
        }).then(() => refreshGameState());
    }
}

// Tick du timer chaque seconde
setInterval(tickStoryTimer, 1000);

// -----------------------------------------------------------
// Rafraîchissement de l’état de la partie depuis l’API backend
// -----------------------------------------------------------
function refreshGameState() {
    fetch(`/api/game/${sessionId}`)
        .then(r => r.json())
        .then(data => {
            if (data.error) return;

            // Mise à jour de l’état global
            lastGameMode    = data.gameMode || "strict";
            lastRoundNumber = data.roundNumber || 1;
            lastStatus      = data.status || "waiting";

            updateTimerFromData(data);

            // Texte de la story + numéro de tour
            if (data.currentStory) {
                storyTextEl.textContent = data.currentStory;
            }
            if (roundInfoEl) {
                roundInfoEl.textContent = `Tour ${lastRoundNumber}`;
            }

            // Réinitialisation du message de statut global
            if (gameStatusText) {
                gameStatusText.style.display = "none";
                gameStatusText.textContent   = "";
            }

            // -------------------------------
            // Affichage de l’historique
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
            // Affichage des joueurs autour de la table
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
                    // Après révélation : on affiche directement la valeur votée
                    seat.classList.add("revealed");
                    s.textContent =
                        (p.vote !== null && p.vote !== undefined) ? p.vote : "—";
                } else {
                    // Avant révélation : simple statut “A voté / En attente”
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
            // Gestion de la pause café
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
                if (nextBtn)      nextBtn.style.display = "none";
                if (revoteBtn)    revoteBtn.style.display = "none";
                if (forceNextBtn) forceNextBtn.style.display = "none";

                // On fige le timer côté client pendant la pause
                timerPerStorySeconds = 0;
                timerStartTimestamp  = null;
                return;
            } else if (resumeBtn) {
                // Masque le bouton Reprendre dès que la partie repart
                resumeBtn.style.display = "none";
            }

            // -------------------------------
            // Gestion de la fin de partie
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
                if (forceNextBtn) forceNextBtn.style.display = "none";

                return;
            }

            // -------------------------------
            // Partie en cours (non en pause)
            // -------------------------------
            setCardsEnabled(true);

            // ---------- Avant révélation des cartes ----------
            if (!data.reveal) {
                lastComputedResult = null;

                // Messages d’aide en fonction de qui a voté
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

                // Bouton “Révéler les cartes” visible seulement
                // pour l’orga et quand tout le monde a voté
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
                if (forceNextBtn) forceNextBtn.style.display = "none";

                return;
            }

            // ---------- Après révélation des cartes ----------
            const allVotesCount = (data.participants || []).length;
            const rawVotes      = (data.participants || []).map(p => p.vote);
            const numericVotes  = rawVotes
                .map(v => parseInt(v))
                .filter(Number.isFinite);

            let unanimity = false;
            if (numericVotes.length === allVotesCount && allVotesCount > 0) {
                unanimity = numericVotes.every(v => v === numericVotes[0]);
            }

            const strictModeAlways = (lastGameMode === "strict");
            const isStrictTurn     = strictModeAlways || (lastRoundNumber === 1);

            if (revealButton) {
                revealButton.style.display = "none";
            }
            if (revealHint) {
                revealHint.textContent = "Les cartes sont révélées.";
            }

            // ----- Mode strict (unanimité requise sur le 1er tour) -----
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
                    if (nextBtn)      nextBtn.style.display = "none";
                    if (forceNextBtn) forceNextBtn.style.display = "none";
                }
            } else {
                // ----- Modes automatiques (moyenne, médiane, majorités…) -----
                if (!numericVotes.length) {
                    lastComputedResult = null;
                    tableStatus.textContent =
                        "Les joueurs n'ont pas choisi de valeur numérique (café / ?).";
                    if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
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
                    // Cas où un résultat automatique a été trouvé
                    lastComputedResult = result;
                    tableStatus.textContent =
                        `✅ Résultat (${label}) : ${result}. ${message}`;
                    if (isOrganizer && nextBtn)   nextBtn.style.display = "block";
                    if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
                    if (forceNextBtn)             forceNextBtn.style.display = "none";
                } else {
                    // Aucun résultat automatique fiable
                    lastComputedResult = null;
                    tableStatus.textContent = `❌ ${message}`;
                    if (isOrganizer && revoteBtn) revoteBtn.style.display = "block";
                    if (nextBtn)      nextBtn.style.display = "none";
                    if (forceNextBtn) forceNextBtn.style.display = "none";
                }
            }
        });
}

// Rafraîchissement régulier de l’état de la partie
setInterval(refreshGameState, 2000);
refreshGameState();
window.addEventListener("resize", layoutSeats);

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
            .then(() => refreshGameState());
    });
}

if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
        fetch(`/resume/${sessionId}`, { method: "POST" })
            .then(() => refreshGameState());
    });
}
