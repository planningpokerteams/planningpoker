/**
 * @fileoverview
 * create.js — Page de création de session
 * --------------------------------------
 * - Affiche la description du mode de jeu sélectionné
 * - Permet d'ajouter des User Stories (US)
 * - Permet de réordonner les US via drag & drop
 * - Prépare les champs hidden avant l'envoi du formulaire au backend
 */

/* ========================================================================== */
/* 1) Types (JSDoc)                                                           */
/* ========================================================================== */

/**
 * Liste des descriptions par mode de jeu.
 * @typedef {Object.<string, string>} ModeDescriptions
 */

/* ========================================================================== */
/* 2) Bootstrap DOMContentLoaded                                               */
/* ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  /* ======================================================================== */
  /* 2.1) Récupération des éléments DOM                                        */
  /* ======================================================================== */

  /** @type {HTMLButtonElement|null} */
  const addBtn = document.getElementById("add-story-btn");

  /** @type {HTMLElement|null} */
  const storiesListEl = document.getElementById("stories-list");

  /** @type {HTMLElement|null} */
  const storiesHidden = document.getElementById("stories-hidden");

  /** @type {HTMLInputElement|null} */
  const inputStory = document.getElementById("userStories-input");

  /** @type {HTMLFormElement|null} */
  const form = document.getElementById("create-form");

  /** @type {HTMLSelectElement|null} */
  const modeSelect = document.getElementById("game_mode");

  /** @type {HTMLElement|null} */
  const modeDesc = document.getElementById("mode-description");

  /* ======================================================================== */
  /* 2.2) État local                                                          */
  /* ======================================================================== */

  /** @type {string[]} */
  let stories = [];

  /** @type {number|null} */
  let draggedIndex = null;

  /* ======================================================================== */
  /* 2.3) Mode descriptions                                                    */
  /* ======================================================================== */

  /** @type {ModeDescriptions} */
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

  /**
   * Met à jour le paragraphe de description en fonction du mode choisi.
   * @returns {void}
   */
/**
 * @brief Fonction `updateModeDescription`.
 *
 * @returns {*} 
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

  /* ======================================================================== */
  /* 2.4) Liste US : rendu + drag & drop                                       */
  /* ======================================================================== */

  /**
   * Re-render la liste des user stories dans le DOM.
   * @returns {void}
   */
/**
 * @brief Fonction `renderStories`.
 *
 * @returns {*} 
 */
  function renderStories() {
    if (!storiesListEl) return;

    storiesListEl.innerHTML = "";

    stories.forEach((text, index) => {
      const item = document.createElement("div");
      item.className = "story-item";
      item.draggable = true;
      item.dataset.index = String(index);

      item.innerHTML = `
        <span class="story-index">US ${index + 1}</span>
        <span class="story-text">${text}</span>
      `;

      item.addEventListener("dragstart", (e) => {
        draggedIndex = index;
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        item.classList.add("story-item--dragover");
      });

      item.addEventListener("dragleave", () => {
        item.classList.remove("story-item--dragover");
      });

      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("story-item--dragover");

        if (draggedIndex === null) return;

        const targetIndex = index;
        if (targetIndex === draggedIndex) return;

        const moved = stories.splice(draggedIndex, 1)[0];
        stories.splice(targetIndex, 0, moved);

        draggedIndex = null;
        renderStories();
      });

      storiesListEl.appendChild(item);
    });
  }

  /**
   * Ajoute le contenu du champ texte à la liste `stories`.
   * @returns {void}
   */
/**
 * @brief Fonction `addStoryFromInput`.
 *
 * @returns {*} 
 */
  function addStoryFromInput() {
    if (!inputStory) return;
    const value = inputStory.value.trim();
    if (!value) return;

    stories.push(value);
    inputStory.value = "";
    renderStories();
  }

  if (addBtn) addBtn.addEventListener("click", addStoryFromInput);

  if (inputStory) {
    inputStory.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addStoryFromInput();
      }
    });
  }

  /* ======================================================================== */
  /* 2.5) Soumission formulaire : hidden inputs + validation                   */
  /* ======================================================================== */

  if (form) {
    form.addEventListener("submit", (e) => {
      if (!storiesHidden || !inputStory) return;

      // Si une US est encore dans le champ, on l'ajoute avant envoi
      if (inputStory.value.trim()) addStoryFromInput();

      // Recrée un input hidden par US
      storiesHidden.innerHTML = "";
      stories.forEach((text) => {
        const inp = document.createElement("input");
        inp.type = "hidden";
        inp.name = "userStories";
        inp.value = text;
        storiesHidden.appendChild(inp);
      });

      // Validation : au moins une user story
      if (stories.length === 0) {
        e.preventDefault();
        alert("Ajoute au moins une user story avant de créer la session.");
      }
    });
  }
});
