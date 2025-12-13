// tests/frontend/create.test.js

/**
 * Tests de la logique DOM de create.js :
 * - ajout de user stories
 * - génération des inputs hidden avant submit
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const htmlPath = path.join(process.cwd(), "templates", "create.html");
const scriptPath = path.join(
  process.cwd(),
  "static",
  "scripts",
  "create.js"
);

function loadCreatePage() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only" });

  global.window = dom.window;
  global.document = dom.window.document;

  const scriptCode = fs.readFileSync(scriptPath, "utf8");
  dom.window.eval(scriptCode);

  // Très important : déclencher DOMContentLoaded pour que le code
  // dans create.js (document.addEventListener('DOMContentLoaded', ...))
  // s'exécute réellement.
  dom.window.document.dispatchEvent(
    new dom.window.Event("DOMContentLoaded", {
      bubbles: true,
      cancelable: true,
    })
  );

  return dom;
}

describe("create.js – gestion des user stories", () => {
  test("ajout d'une user story met à jour la liste visuelle", () => {
    const dom = loadCreatePage();
    const doc = dom.window.document;

    const inputStory = doc.getElementById("userStories-input");
    const addBtn = doc.getElementById("add-story-btn");
    const list = doc.getElementById("stories-list");

    inputStory.value = "US A";
    addBtn.click();

    expect(list.textContent).toContain("US A");
  });

  test("génère des inputs hidden avant submit", () => {
    const dom = loadCreatePage();
    const doc = dom.window.document;

    const inputStory = doc.getElementById("userStories-input");
    const addBtn = doc.getElementById("add-story-btn");
    const form = doc.getElementById("create-form");
    const hiddenContainer = doc.getElementById("stories-hidden");

    inputStory.value = "US A";
    addBtn.click();
    inputStory.value = "US B";
    addBtn.click();

    const submitEvent = new dom.window.Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    form.dispatchEvent(submitEvent);

    const hiddenInputs = hiddenContainer.querySelectorAll(
      "input[name='userStories']"
    );
    expect(hiddenInputs.length).toBe(2);
    expect(hiddenInputs[0].value).toBe("US A");
    expect(hiddenInputs[1].value).toBe("US B");
  });
});
