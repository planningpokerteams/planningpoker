// tests/frontend/waiting.test.js

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const scriptPath = path.join(
  process.cwd(),
  "static",
  "scripts",
  "waiting.js" // adapte si ton fichier est ailleurs
);

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

  // Mock fetch AVANT de charger waiting.js
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

  const code = fs.readFileSync(scriptPath, "utf8");
  dom.window.eval(code);

  // Déclenche DOMContentLoaded pour exécuter le code de waiting.js
  dom.window.document.dispatchEvent(
    new dom.window.Event("DOMContentLoaded", {
      bubbles: true,
      cancelable: true,
    })
  );

  return { dom, fetchMock: global.fetch };
}

describe("waiting.js – rafraîchissement des participants", () => {
  test("appelle l'API participants avec le bon sessionId", async () => {
    const { fetchMock } = setupWaitingDom();

    // Laisser le temps à fetch().json() de se lancer
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/participants/ABC123");
  });
});
