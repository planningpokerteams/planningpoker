/**
 * @fileoverview
 * vote-utils.js — Fonctions utilitaires (calculs Planning Poker)
 * --------------------------------------------------------------
 * Utilisé :
 * - côté navigateur (via <script>)
 * - côté tests Jest (via require / CommonJS)
 *
 * Objectif : fonctions "pures" (pas de DOM), testables facilement.
 */

/* ========================================================================== */
/* 1) Constantes                                                              */
/* ========================================================================== */

/**
 * Deck Fibonacci simplifié (cartes disponibles).
 * @type {number[]}
 */
const PLANNING_DECK = [1, 2, 3, 5, 8, 13];

/* ========================================================================== */
/* 2) Types (JSDoc)                                                           */
/* ========================================================================== */

/**
 * Résultat de calcul pour la moyenne.
 * @typedef {Object} AverageResult
 * @property {number} avg  - Moyenne brute
 * @property {number} card - Carte du deck la plus proche
 */

/**
 * Résultat de calcul pour la médiane.
 * @typedef {Object} MedianResult
 * @property {number} median - Médiane brute
 * @property {number} card   - Carte du deck la plus proche
 */

/**
 * Dictionnaire d'occurrences (ex: {"3": 2, "5": 1}).
 * @typedef {Object.<string, number>} VoteCounts
 */

/* ========================================================================== */
/* 3) Fonctions                                                               */
/* ========================================================================== */

/**
 * Retourne la carte du deck la plus proche d’une valeur.
 * @param {number} value
 * @returns {number}
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
 * Calcule la moyenne et renvoie la carte la plus proche.
 * @param {number[]} votes
 * @returns {AverageResult}
 */
function computeAverage(votes) {
  const sum = votes.reduce((a, b) => a + b, 0);
  const avg = sum / votes.length;
  return { avg, card: nearestCard(avg) };
}

/**
 * Calcule la médiane et renvoie la carte la plus proche.
 * @param {number[]} votes
 * @returns {MedianResult}
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
 * Compte les occurrences de chaque valeur.
 * @param {number[]} votes
 * @returns {VoteCounts}
 */
function computeCounts(votes) {
  /** @type {VoteCounts} */
  const counts = {};

  votes.forEach((v) => {
    counts[String(v)] = (counts[String(v)] || 0) + 1;
  });

  return counts;
}

/* ========================================================================== */
/* 4) Exports                                                                 */
/* ========================================================================== */

const api = {
  PLANNING_DECK,
  nearestCard,
  computeAverage,
  computeMedian,
  computeCounts,
};

// CommonJS (Jest / Node)
if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

// Browser global (optionnel)
if (typeof window !== "undefined") {
  window.VoteUtils = api;
}
