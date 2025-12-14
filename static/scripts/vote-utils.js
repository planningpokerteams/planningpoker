/**
 * @file vote-utils.js
 * @description
 * Fonctions utilitaires *pures* utilisées par l'UI et surtout par les tests Jest.
 * Ici on ne touche pas au DOM : on calcule des stats (moyenne, médiane, etc.)
 * et on mappe une valeur sur la carte Planning Poker la plus proche.
 *
 * Ce fichier est chargé côté Node (tests) via `require(...)`.
 */

/**
 * Set de cartes Planning Poker autorisées.
 * @type {number[]}
 */
const CARDS = [0, 0.5, 1, 2, 3, 5, 8, 13, 20, 40, 100];

/**
 * Trouve la carte Planning Poker la plus proche de `value`.
 * @param {number} value - Valeur cible (moyenne/médiane/etc.).
 * @returns {(number|null)} Carte la plus proche, ou null si `value` n'est pas un nombre.
 */
function nearestCard(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;

  let best = CARDS[0];
  let bestDist = Math.abs(value - best);

  for (let i = 1; i < CARDS.length; i++) {
    const d = Math.abs(value - CARDS[i]);
    if (d < bestDist) {
      bestDist = d;
      best = CARDS[i];
    }
  }
  return best;
}

/**
 * Calcule la moyenne des votes numériques et la carte la plus proche.
 * @param {number[]} votes - Liste de votes (ex: [1, 2, 3]).
 * @returns {{avg:number, card:(number|null)}} Résultat (moyenne + carte la plus proche).
 */
function computeAverage(votes) {
  const sum = votes.reduce((a, b) => a + b, 0);
  const avg = sum / votes.length;
  return { avg, card: nearestCard(avg) };
}

/**
 * Calcule la médiane des votes numériques et la carte la plus proche.
 * @param {number[]} votes - Liste de votes (ex: [1, 2, 3]).
 * @returns {{median:number, card:(number|null)}} Résultat (médiane + carte la plus proche).
 */
function computeMedian(votes) {
  const sorted = [...votes].sort((a, b) => a - b);
  let median;

  if (sorted.length % 2 === 1) {
    median = sorted[(sorted.length - 1) / 2];
  } else {
    median = (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  }

  return { median, card: nearestCard(median) };
}

module.exports = { nearestCard, computeAverage, computeMedian, CARDS };
