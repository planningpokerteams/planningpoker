// static/scripts/vote-utils.js

const PLANNING_DECK = [1, 2, 3, 5, 8, 13];

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

function computeAverage(votes) {
  const sum = votes.reduce((a, b) => a + b, 0);
  const avg = sum / votes.length;
  return { avg, card: nearestCard(avg) };
}

function computeMedian(votes) {
  const sorted = [...votes].sort((a, b) => a - b);
  let median;
  if (sorted.length % 2 === 1) {
    median = sorted[(sorted.length - 1) / 2];
  } else {
    median =
      (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  }
  return { median, card: nearestCard(median) };
}

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
