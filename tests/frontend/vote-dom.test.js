// tests/frontend/vote-dom.test.js

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const scriptPath = path.join(
  process.cwd(),
  "static",
  "scripts",
  "vote.js" // adapte si besoin
);

function loadVoteDom() {
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

  // Spy sur le submit natif AVANT de charger vote.js
  const submitSpy = jest
    .spyOn(dom.window.HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {}); // évite l'erreur "Not implemented" de jsdom [web:106]

  // Mock fetch pour les appels /api/game/<sessionId>
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

  // Config globale injectée normalement par Jinja
  dom.window.GAME_CONFIG = {
    sessionId: "TEST01",
    currentUser: "Alice",
    isOrganizer: false,
  };

  const code = fs.readFileSync(scriptPath, "utf8");
  dom.window.eval(code);

  // Déclencher DOMContentLoaded si vote.js s'y accroche
  dom.window.document.dispatchEvent(
    new dom.window.Event("DOMContentLoaded", {
      bubbles: true,
      cancelable: true,
    })
  );

  return { dom, submitSpy };
}

describe("vote.js – clic sur une carte", () => {
  test("met à jour le champ hidden et soumet le formulaire", () => {
    const { dom, submitSpy } = loadVoteDom();
    const { document } = dom.window;

    const cards = document.querySelectorAll(".poker-card");
    const voteInput = document.getElementById("vote-input");
    const status = document.getElementById("table-status-text");

    // clic sur la deuxième carte (valeur 5)
    cards[1].click();

    expect(voteInput.value).toBe("5");
    expect(submitSpy).toHaveBeenCalled(); // on vérifie l'appel à submit natif
    expect(status.textContent).toContain("Ton vote est enregistré");
    expect(cards[1].classList.contains("poker-card--selected")).toBe(true);
    expect(cards[0].classList.contains("poker-card--selected")).toBe(false);
  });
});
