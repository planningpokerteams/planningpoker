/**
 * @file static/scripts/vote-utils.js
 * @brief Fonctions utilitaires “pures” pour les calculs Planning Poker.
 * @details
 * Ce module est utilisé côté tests (Node/Jest) et peut servir côté client
 * pour centraliser la logique de calcul :
 * - nearestCard : carte Fibonacci la plus proche
 * - computeAverage : moyenne et carte la plus proche
 * - computeMedian : médiane et carte la plus proche
 * - computeCounts : histogramme des votes
 *
 * Remarque :
 * Ici on exporte via module.exports (CommonJS) pour Jest.
 */

/**
 * @brief Deck Planning Poker (Fibonacci simplifié).
 * @type {number[]}
 */
const PLANNING_DECK = [1, 2, 3, 5, 8, 13];

/**
 * @brief Retourne la carte du deck la plus proche d’une valeur numérique.
 * @param {number} value Valeur numérique (ex : moyenne/médiane).
 * @returns {number} Carte du deck la plus proche.
 */
function nearestCard(value) {
  let best = PLANNING_DECK[0];
  let bestDiff = Math.abs(value - best);

  PLANNING_DECK.forEach((v) => {
    const d = Math.abs(value - v);
    if (d < bestDiff) {
      bestDiff = d;
      best = v;
    }
  });

  return best;
}

/**
 * @brief Calcule la moyenne d’une liste de votes numériques.
 * @param {number[]} votes Votes numériques.
 * @returns {{avg:number, card:number}} Moyenne exacte + carte la plus proche.
 */
function computeAverage(votes) {
  const sum = votes.reduce((a, b) => a + b, 0);
  const avg = sum / votes.length;
  return { avg, card: nearestCard(avg) };
}

/**
 * @brief Calcule la médiane d’une liste de votes numériques.
 * @param {number[]} votes Votes numériques.
 * @returns {{median:number, card:number}} Médiane exacte + carte la plus proche.
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

/**
 * @brief Construit un histogramme des occurrences de votes.
 * @param {number[]} votes Votes numériques.
 * @returns {Object<string, number>} Dictionnaire {valeur: occurrences}.
 */
function computeCounts(votes) {
  const counts = {};
  votes.forEach((v) => {
    counts[v] = (counts[v] || 0) + 1;
  });
  return counts;
}

module.exports = {
  PLANNING_DECK,
  nearestCard,
  computeAverage,
  computeMedian,
  computeCounts,
};
