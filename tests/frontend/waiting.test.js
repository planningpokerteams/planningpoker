/**
 * @file tests/frontend/waiting.test.js
 * @description
 * Test DOM (JSDOM) du script waiting.js :
 * - waiting.js doit lire le sessionId depuis l'attribut data-session-id
 * - puis appeler l'API /api/participants/<sessionId> pour récupérer les joueurs
 *
 * Ce test se concentre sur :
 * - l'appel fetch avec la bonne URL
 */

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

/** Chemin vers le script waiting côté client */
const scriptPath = path.join(process.cwd(), "static", "scripts", "waiting.js"); // adapte si besoin

/**
 * Crée un DOM minimal pour la page waiting et injecte waiting.js.
 * @returns {{ dom: JSDOM, fetchMock: jest.Mock }}
 */
function setupWaitingDom() {
  const html = `
    <main class="hero" data-session-id="ABC123">
      <div id="waiting-timer"><span></span></div>
      <ul id="participants-list"></ul>
    </main>
  `;

  const dom = new JSDOM(html, { runScripts: "outside-only" });

  global.window = dom.window;
  global.document = dom.window.document;

  /**
   * Mock fetch : on renvoie une réponse de participants minimale.
   * Le contenu n'est pas l'objet du test ici, mais on doit renvoyer
   * une structure attendue pour que waiting.js ne plante pas.
   */
  global.fetch = dom.window.fetch = jest.fn(() =>
    Promise.resolve({
      json: async () => ({
        participants: [
          { name: "Alice", avatarSeed: "astronaut" },
          { name: "Bob", avatarSeed: "ninja" },
        ],
        status: "waiting",
      }),
    })
  );

  // Injecte waiting.js
  const code = fs.readFileSync(scriptPath, "utf8");
  dom.window.eval(code);

  // Déclenche DOMContentLoaded si waiting.js s'y accroche
  dom.window.document.dispatchEvent(
    new dom.window.Event("DOMContentLoaded", {
      bubbles: true,
      cancelable: true,
    })
  );

  return { dom, fetchMock: global.fetch };
}

describe("waiting.js — rafraîchissement des participants", () => {
  test("appelle l'API participants avec le bon sessionId", async () => {
    const { fetchMock } = setupWaitingDom();

    // Laisse le temps aux Promises (fetch().json()) de s'exécuter
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/participants/ABC123");
  });
});
