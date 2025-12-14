/**
 * @file tests/frontend/create.test.js
 * @description
 * Tests d'intégration DOM (JSDOM) pour la page "create" (create.html + create.js).
 *
 * Objectifs de test :
 * - Vérifier l'ajout d'une user story dans la liste visuelle.
 * - Vérifier la génération d'inputs hidden avant la soumission du formulaire
 *   (permet d'envoyer correctement les user stories au backend).
 *
 * Dépendances :
 * - templates/create.html
 * - static/scripts/create.js
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

/** Chemin vers le template HTML de la page create */
const htmlPath = path.join(process.cwd(), "templates", "create.html");

/** Chemin vers le script client exécuté sur la page create */
const scriptPath = path.join(process.cwd(), "static", "scripts", "create.js");

/**
 * Charge create.html dans JSDOM, injecte create.js, puis déclenche DOMContentLoaded.
 * On simule ainsi un "vrai" chargement navigateur pour exécuter le code
 * enregistré dans `document.addEventListener('DOMContentLoaded', ...)`.
 *
 * @returns {JSDOM} Instance JSDOM prête à être testée.
 */
function loadCreatePage() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only" });

  // Expose window/document pour que le script testé fonctionne
  global.window = dom.window;
  global.document = dom.window.document;

  // Injecte le code de create.js dans l'environnement JSDOM
  const scriptCode = fs.readFileSync(scriptPath, "utf8");
  dom.window.eval(scriptCode);

  // Important : déclencher DOMContentLoaded pour lancer l'init du script
  dom.window.document.dispatchEvent(
    new dom.window.Event("DOMContentLoaded", {
      bubbles: true,
      cancelable: true,
    })
  );

  return dom;
}

describe("create.js — gestion des user stories (DOM)", () => {
  /**
   * Cas nominal : ajouter une user story via l'input + bouton doit
   * mettre à jour la liste visuelle (#stories-list).
   */
  test("ajouter une user story met à jour la liste visuelle", () => {
    const dom = loadCreatePage();
    const doc = dom.window.document;

    const inputStory = doc.getElementById("userStories-input");
    const addBtn = doc.getElementById("add-story-btn");
    const list = doc.getElementById("stories-list");

    inputStory.value = "US A";
    addBtn.click();

    expect(list.textContent).toContain("US A");
  });

  /**
   * Avant submit, create.js doit convertir la liste interne de stories
   * en inputs hidden (name='userStories') insérés dans #stories-hidden.
   * Objectif : le backend reçoit bien toutes les stories.
   */
  test("génère des inputs hidden avant submit", () => {
    const dom = loadCreatePage();
    const doc = dom.window.document;

    const inputStory = doc.getElementById("userStories-input");
    const addBtn = doc.getElementById("add-story-btn");
    const form = doc.getElementById("create-form");
    const hiddenContainer = doc.getElementById("stories-hidden");

    // Ajout de 2 stories
    inputStory.value = "US A";
    addBtn.click();
    inputStory.value = "US B";
    addBtn.click();

    // Déclenche un submit (le script doit intercepter et injecter les hidden inputs)
    const submitEvent = new dom.window.Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    form.dispatchEvent(submitEvent);

    // Vérifie la présence des inputs hidden
    const hiddenInputs = hiddenContainer.querySelectorAll("input[name='userStories']");
    expect(hiddenInputs.length).toBe(2);
    expect(hiddenInputs[0].value).toBe("US A");
    expect(hiddenInputs[1].value).toBe("US B");
  });
});
