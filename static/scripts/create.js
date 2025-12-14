/**
 * @file static/scripts/create.js
 * @brief Script client de la page de création de session.
 * @details
 * Gère :
 * - l’affichage de la description du mode de jeu sélectionné
 * - la gestion des user stories (ajout, affichage, numérotation)
 * - le drag & drop pour réordonner les user stories
 * - la génération d’inputs hidden avant la soumission du formulaire
 *
 * Dépendances DOM attendues (create.html) :
 * - #game_mode, #mode-description
 * - #userStories-input, #add-story-btn, #stories-list, #stories-hidden
 * - #create-form
 */

document.addEventListener('DOMContentLoaded', () => {
    // ------------------------------------------------------------
    // Récupération des éléments du formulaire de création
    // ------------------------------------------------------------
    const addBtn        = document.getElementById('add-story-btn');      // Bouton “Ajouter” une US
    const storiesListEl = document.getElementById('stories-list');       // Liste visuelle des US
    const storiesHidden = document.getElementById('stories-hidden');     // Conteneur d’inputs hidden
    const inputStory    = document.getElementById('userStories-input');  // Champ texte pour une nouvelle US
    const form          = document.getElementById('create-form');        // Formulaire complet

    /**
     * @brief Liste des user stories (dans l’ordre courant).
     * @type {string[]}
     */
    let stories = [];

    /**
     * @brief Index de l’élément actuellement “draggué” (null si aucun).
     * @type {number|null}
     */
    let draggedIndex = null;

    // ------------------------------------------------------------
    // Description textuelle des différents modes de jeu
    // ------------------------------------------------------------
    const modeSelect = document.getElementById('game_mode');           // <select> du mode
    const modeDesc   = document.getElementById('mode-description');    // <p> qui affiche la description

    /**
     * @brief Dictionnaire des descriptions pour chaque mode de jeu.
     * @type {Object<string,string>}
     */
    const MODE_DESCRIPTIONS = {
        strict: "Tous les tours sont en mode strict : il faut une unanimité sur une même carte pour valider l’estimation, sinon vous discutez et revotez.",
        average: "Tour 1 en mode strict. À partir du 2ᵉ tour, on calcule la moyenne des votes numériques et on retient la carte la plus proche.",
        median: "Tour 1 en mode strict. À partir du 2ᵉ tour, on prend la médiane des votes numériques, puis la carte la plus proche.",
        abs: "Tour 1 en mode strict. À partir du 2ᵉ tour, une valeur est retenue si elle obtient plus de 50% des votes numériques (majorité absolue).",
        rel: "Tour 1 en mode strict. À partir du 2ᵉ tour, on retient la valeur la plus votée (majorité relative), sauf en cas d’égalité."
    };

    /**
     * @brief Met à jour le texte de description en fonction du mode sélectionné.
     * @details Lit la valeur du `<select id="game_mode">` et affiche la description associée.
     * @return {void}
     */
    function updateModeDescription() {
        const v = modeSelect.value || "strict";
        modeDesc.textContent = MODE_DESCRIPTIONS[v] || "";
    }

    // Initialisation du texte + écoute du changement de mode
    if (modeSelect) {
        modeSelect.addEventListener('change', updateModeDescription);
        updateModeDescription();
    }

    // ------------------------------------------------------------
    // Gestion de la liste des user stories (affichage + drag & drop)
    // ------------------------------------------------------------

    /**
     * @brief Ré-affiche la liste des user stories dans #stories-list.
     * @details
     * Reconstruit entièrement le DOM de la liste :
     * - un bloc par story
     * - numérotation “US 1”, “US 2”, ...
     * - listeners drag & drop pour réordonner `stories`
     * @return {void}
     */
    function renderStories() {
        storiesListEl.innerHTML = "";

        stories.forEach((text, index) => {
            const item = document.createElement('div');
            item.className = 'story-item';
            item.draggable = true;
            item.dataset.index = index.toString();

            // Contenu visuel : numéro + texte de la user story
            item.innerHTML = `
                <span class="story-index">US ${index + 1}</span>
                <span class="story-text">${text}</span>
            `;

            /**
             * @brief Début du drag : mémorise l’index d’origine.
             */
            item.addEventListener('dragstart', (e) => {
                draggedIndex = index;
                e.dataTransfer.effectAllowed = 'move';
            });

            /**
             * @brief Survol pendant drag : autorise le drop + feedback visuel.
             */
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                item.classList.add('story-item--dragover');
            });

            /**
             * @brief Sortie du survol : retire le feedback visuel.
             */
            item.addEventListener('dragleave', () => {
                item.classList.remove('story-item--dragover');
            });

            /**
             * @brief Drop : réordonne le tableau `stories` puis re-render.
             */
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('story-item--dragover');
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
     * @brief Ajoute la user story saisie dans l’input à la liste `stories`.
     * @details
     * - trim()
     * - ignore si vide
     * - vide l’input après ajout
     * - re-render la liste
     * @return {void}
     */
    function addStoryFromInput() {
        const value = inputStory.value.trim();
        if (!value) return;
        stories.push(value);
        inputStory.value = "";
        renderStories();
    }

    // Clic sur le bouton “+” pour ajouter une nouvelle US
    if (addBtn) {
        addBtn.addEventListener('click', addStoryFromInput);
    }

    // Touche Entrée dans le champ texte pour ajouter rapidement une US
    if (inputStory) {
        inputStory.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addStoryFromInput();
            }
        });
    }

    // ------------------------------------------------------------
    // Préparation des données avant envoi du formulaire
    // ------------------------------------------------------------
    if (form) {
        form.addEventListener('submit', (e) => {
            // Si une US est encore dans le champ texte, on l’ajoute d’abord
            if (inputStory.value.trim()) {
                addStoryFromInput();
            }

            // On vide le conteneur, puis on recrée un input hidden par US
            storiesHidden.innerHTML = "";
            stories.forEach(text => {
                const inp = document.createElement('input');
                inp.type  = 'hidden';
                inp.name  = 'userStories';
                inp.value = text;
                storiesHidden.appendChild(inp);
            });

            // Validation : au moins une user story est requise
            if (stories.length === 0) {
                e.preventDefault();
                alert("Ajoute au moins une user story avant de créer la session.");
            }
        });
    }
});
