// Script de gestion du formulaire de création de session
// - description des modes de jeu
// - gestion de la liste de user stories (ajout, drag & drop, envoi au backend)
document.addEventListener('DOMContentLoaded', () => {
    // ------------------------------------------------------------
    // Récupération des éléments du formulaire de création
    // ------------------------------------------------------------
    const addBtn        = document.getElementById('add-story-btn');   // Bouton “Ajouter” une US
    const storiesListEl = document.getElementById('stories-list');    // Liste visuelle des US
    const storiesHidden = document.getElementById('stories-hidden');  // Conteneur d’inputs hidden
    const inputStory    = document.getElementById('userStories-input'); // Champ texte pour une nouvelle US
    const form          = document.getElementById('create-form');     // Formulaire complet

    // Tableau en mémoire contenant les user stories dans l’ordre
    let stories = [];
    // Index de la carte actuellement “dragguée”
    let draggedIndex = null;

    // ------------------------------------------------------------
    // Description textuelle des différents modes de jeu
    // ------------------------------------------------------------
    const modeSelect = document.getElementById('game_mode');          // <select> du mode
    const modeDesc   = document.getElementById('mode-description');   // <p> qui affiche la description

    const MODE_DESCRIPTIONS = {
        strict: "Tous les tours sont en mode strict : il faut une unanimité sur une même carte pour valider l’estimation, sinon vous discutez et revotez.",
        average: "Tour 1 en mode strict. À partir du 2ᵉ tour, on calcule la moyenne des votes numériques et on retient la carte la plus proche.",
        median: "Tour 1 en mode strict. À partir du 2ᵉ tour, on prend la médiane des votes numériques, puis la carte la plus proche.",
        abs: "Tour 1 en mode strict. À partir du 2ᵉ tour, une valeur est retenue si elle obtient plus de 50% des votes numériques (majorité absolue).",
        rel: "Tour 1 en mode strict. À partir du 2ᵉ tour, on retient la valeur la plus votée (majorité relative), sauf en cas d’égalité."
    };

    // Met à jour le paragraphe de description en fonction du mode choisi
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

            // Début du drag : on mémorise l’index d’origine
            item.addEventListener('dragstart', (e) => {
                draggedIndex = index;
                e.dataTransfer.effectAllowed = 'move';
            });

            // Drag au-dessus d’un autre élément : on ajoute une classe de survol
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                item.classList.add('story-item--dragover');
            });

            // Sortie du survol : on retire la classe
            item.addEventListener('dragleave', () => {
                item.classList.remove('story-item--dragover');
            });

            // Drop : on réordonne le tableau `stories` puis on ré-affiche
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

    // Ajoute le contenu du champ texte à la liste `stories`
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
