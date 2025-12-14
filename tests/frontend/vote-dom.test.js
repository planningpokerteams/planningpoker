/**
 * @file tests/frontend/vote-dom.test.js
 * @description
 * Test DOM (JSDOM) du comportement utilisateur principal de vote.js :
 * - Cliquer sur une carte sélectionne la carte
 * - Remplit le champ hidden #vote-input
 * - Soumet le formulaire #vote-form
 * - Affiche un message de statut
 *
 * Important :
 * - jsdom ne supporte pas "form.submit()" nativement dans certains cas,
 *   donc on mocke HTMLFormElement.prototype.submit.
 * - vote.js fait aussi des fetch (refresh game state) : on mock fetch.
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

/** Chemin vers le script de vote côté client */
const scriptPath = path.join(process.cwd(), "static", "scripts", "vote.js"); // adapte si besoin

/**
 * Construit un DOM minimal avec les éléments attendus par vote.js,
 * puis injecte le script vote.js.
 *
 * @returns {{dom: JSDOM, submitSpy: jest.SpyInstance}} DOM + spy submit()
 */
function loadVoteDom() {
  // HTML minimal : uniquement ce dont vote.js a besoin pour ce test
  const html = `
    <main>
      <form id="vote-form">
        <input id="vote-input" name="vote" />
      </form>

      <div id="table-status-text"></div>
      <div id="story-text"></div>
      <div id="round-info"></div>
      <div id="poker-table"></div>
      <button id="reveal-button"></button>
      <div id="reveal-hint"></div>
      <button id="next-button"></button>
      <button id="revote-button"></button>
      <button id="force-next-button"></button>
      <button id="resume-button"></button>
      <ul id="history-list"></ul>
      <div id="story-timer"><span></span></div>
      <div id="game-status-text"></div>

      <button class="poker-card" data-value="3"></button>
      <button class="poker-card" data-value="5"></button>
    </main>
  `;

  const dom = new JSDOM(html, { runScripts: "outside-only" });

  global.window = dom.window;
  global.document = dom.window.document;

  /**
   * Spy submit : empêche l'erreur "Not implemented" et permet de vérifier
   * que vote.js déclenche bien la soumission.
   */
  const submitSpy = jest
    .spyOn(dom.window.HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {});

  /**
   * Mock fetch : vote.js appelle l'API /api/game/<sessionId> via refreshGameState.
   * On renvoie un état minimal valide.
   */
  global.fetch = dom.window.fetch = jest.fn(() =>
    Promise.resolve({
      json: async () => ({
        status: "started",
        participants: [],
        currentStory: "US 1",
        history: [],
        gameMode: "strict",
        roundNumber: 1,
        timePerStory: 5,
        timerStart: null,
      }),
    })
  );

  // GAME_CONFIG injecté normalement par Jinja
  dom.window.GAME_CONFIG = {
    sessionId: "TEST01",
    currentUser: "Alice",
    isOrganizer: false,
  };

  // Injecte vote.js
  const code = fs.readFileSync(scriptPath, "utf8");
  dom.window.eval(code);

  // Si vote.js écoute DOMContentLoaded : on le déclenche
  dom.window.document.dispatchEvent(
    new dom.window.Event("DOMContentLoaded", {
      bubbles: true,
      cancelable: true,
    })
  );

  return { dom, submitSpy };
}

describe("vote.js — clic sur une carte", () => {
  /**
   * Le test clé : quand l'utilisateur clique une carte,
   * le vote est écrit dans #vote-input et le form est soumis.
   */
  test("met à jour le champ hidden et soumet le formulaire", () => {
    const { dom, submitSpy } = loadVoteDom();
    const { document } = dom.window;

    const cards = document.querySelectorAll(".poker-card");
    const voteInput = document.getElementById("vote-input");
    const status = document.getElementById("table-status-text");

    // clic sur la deuxième carte (valeur 5)
    cards[1].click();

    expect(voteInput.value).toBe("5");
    expect(submitSpy).toHaveBeenCalled();
    expect(status.textContent).toContain("Ton vote est enregistré");

    // Sélection UI : une seule carte "selected"
    expect(cards[1].classList.contains("poker-card--selected")).toBe(true);
    expect(cards[0].classList.contains("poker-card--selected")).toBe(false);
  });
});
