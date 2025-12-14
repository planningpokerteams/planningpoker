/**
 * @file create.js
 * @description
 * Gère la page **Création de partie** :
 * - Affiche la description du mode de jeu sélectionné
 * - Permet d'ajouter des User Stories (US)
 * - Permet de réordonner les US en drag & drop
 * - Prépare les champs cachés avant l'envoi du formulaire vers le backend
 */

/**
 * Dictionnaire des descriptions affichées selon le mode de jeu.
 * @type {Record<string, string>}
 */
const MODE_DESCRIPTIONS = {
  strict:
    "Tous les tours sont en mode strict : il faut une unanimité sur une même carte pour valider l’estimation, sinon vous discutez et revotez.",
  average:
    "Tour 1 en mode strict. À partir du 2ᵉ tour, on calcule la moyenne des votes numériques et on retient la carte la plus proche.",
  median:
    "Tour 1 en mode strict. À partir du 2ᵉ tour, on prend la médiane des votes numériques, puis la carte la plus proche.",
  abs:
    "Tour 1 en mode strict. À partir du 2ᵉ tour, une valeur est retenue si elle obtient plus de 50% des votes numériques (majorité absolue).",
  rel:
    "Tour 1 en mode strict. À partir du 2ᵉ tour, on retient la valeur la plus votée (majorité relative), sauf en cas d’égalité.",
};

document.addEventListener("DOMContentLoaded", () => {
  // ---------------------------------------------------------------------------
  // 1) Récupération des éléments DOM (formulaire + liste des US)
  // ---------------------------------------------------------------------------

  /** @type {HTMLButtonElement|null} Bouton “Ajouter” une US */
  const addBtn = document.getElementById("add-story-btn");

  /** @type {HTMLElement|null} Liste visuelle des US (les “cartes” affichées) */
  const storiesListEl = document.getElementById("stories-list");

  /** @type {HTMLElement|null} Conteneur qui recevra les <input type="hidden"> */
  const storiesHidden = document.getElementById("stories-hidden");

  /** @type {HTMLInputElement|null} Champ texte pour saisir une nouvelle US */
  const inputStory = document.getElementById("userStories-input");

  /** @type {HTMLFormElement|null} Formulaire complet “Créer” */
  const form = document.getElementById("create-form");

  // ---------------------------------------------------------------------------
  // 2) Gestion “Mode de jeu” : texte explicatif qui change selon le <select>
  // ---------------------------------------------------------------------------

  /** @type {HTMLSelectElement|null} Select du mode de jeu */
  const modeSelect = document.getElementById("game_mode");

  /** @type {HTMLElement|null} Paragraphe qui affiche la description du mode */
  const modeDesc = document.getElementById("mode-description");

  /**
   * Met à jour le texte de description en fonction de la valeur du select.
   * (Fallback sur "strict" si vide.)
   * @returns {void}
   */
  function updateModeDescription() {
    if (!modeSelect || !modeDesc) return;
    const v = modeSelect.value || "strict";
    modeDesc.textContent = MODE_DESCRIPTIONS[v] || "";
  }

  if (modeSelect) {
    modeSelect.addEventListener("change", updateModeDescription);
    updateModeDescription();
  }

  // ---------------------------------------------------------------------------
  // 3) Gestion de la liste des User Stories : ajout + rendu + drag & drop
  // ---------------------------------------------------------------------------

  /** @type {string[]} Tableau en mémoire : les US dans l'ordre courant */
  let stories = [];

  /** @type {number|null} Index de la carte actuellement “dragguée” */
  let draggedIndex = null;

  /**
   * Ré-affiche entièrement la liste des US à partir du tableau `stories`.
   * - Reconstruit le DOM
   * - Réattache les listeners de drag & drop
   * @returns {void}
   */
  function renderStories() {
    if (!storiesListEl) return;
    storiesListEl.innerHTML = "";

    stories.forEach((text, index) => {
      const item = document.createElement("div");
      item.className = "story-item";
      item.draggable = true;
      item.dataset.index = String(index);

      // Contenu visuel : numéro + texte
      item.innerHTML = `
        <span class="story-index">US ${index + 1}</span>
        <span class="story-text">${text}</span>
      `;

      // --- Drag start : mémorise l'index d'origine
      item.addEventListener("dragstart", (e) => {
        draggedIndex = index;
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });

      // --- Drag over : autorise le drop + met un style de survol
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        item.classList.add("story-item--dragover");
      });

      // --- Drag leave : retire le style de survol
      item.addEventListener("dragleave", () => {
        item.classList.remove("story-item--dragover");
      });

      // --- Drop : réordonne le tableau puis re-render
      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("story-item--dragover");
        if (draggedIndex === null) return;

        const targetIndex = index;
        if (targetIndex === draggedIndex) return;

        // Retire l’élément déplacé puis le réinsère à la nouvelle position
        const moved = stories.splice(draggedIndex, 1)[0];
        stories.splice(targetIndex, 0, moved);

        draggedIndex = null;
        renderStories();
      });

      storiesListEl.appendChild(item);
    });
  }

  /**
   * Lit le champ texte `inputStory`, ajoute l'US au tableau, puis rafraîchit l'affichage.
   * @returns {void}
   */
  function addStoryFromInput() {
    if (!inputStory) return;
    const value = inputStory.value.trim();
    if (!value) return;

    stories.push(value);
    inputStory.value = "";
    renderStories();
  }

  // --- Ajout via clic sur le bouton “Ajouter”
  if (addBtn) addBtn.addEventListener("click", addStoryFromInput);

  // --- Ajout rapide via Entrée dans le champ texte
  if (inputStory) {
    inputStory.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addStoryFromInput();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 4) Avant envoi du formulaire : convertir `stories` => inputs hidden
  // ---------------------------------------------------------------------------

  if (form) {
    form.addEventListener("submit", (e) => {
      // Si une US est encore dans le champ texte, on l'ajoute d'abord
      if (inputStory && inputStory.value.trim()) addStoryFromInput();

      // Sécurité : si on n'a pas le conteneur hidden, on bloque (sinon backend vide)
      if (!storiesHidden) {
        e.preventDefault();
        alert("Erreur : conteneur des user stories introuvable.");
        return;
      }

      // Recrée un input hidden par US (name = userStories)
      storiesHidden.innerHTML = "";
      stories.forEach((text) => {
        const inp = document.createElement("input");
        inp.type = "hidden";
        inp.name = "userStories";
        inp.value = text;
        storiesHidden.appendChild(inp);
      });

      // Validation : au moins une US est requise
      if (stories.length === 0) {
        e.preventDefault();
        alert("Ajoute au moins une user story avant de créer la session.");
      }
    });
  }
});
