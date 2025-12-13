// tests/frontend/vote-utils.test.js

const {
  PLANNING_DECK,
  nearestCard,
  computeAverage,
  computeMedian,
  computeCounts,
} = require("../../static/scripts/vote-utils");

describe("PLANNING_DECK", () => {
  test("contient les bonnes valeurs", () => {
    expect(PLANNING_DECK).toEqual([1, 2, 3, 5, 8, 13]);
  });
});

describe("nearestCard", () => {
  test("renvoie exactement la valeur si elle est dans le deck", () => {
    expect(nearestCard(1)).toBe(1);
    expect(nearestCard(5)).toBe(5);
    expect(nearestCard(13)).toBe(13);
  });

  test("renvoie la carte la plus proche pour une valeur intermédiaire", () => {
    expect(nearestCard(4)).toBe(3);
    expect(nearestCard(6)).toBe(5);
    expect(nearestCard(9)).toBe(8);
  });
});

describe("computeAverage", () => {
  test("calcule la moyenne et la carte la plus proche", () => {
    const { avg, card } = computeAverage([3, 5, 8]);
    expect(avg).toBeCloseTo((3 + 5 + 8) / 3);
    expect(card).toBe(nearestCard(avg));
  });

  test("gère une liste homogène", () => {
    const { avg, card } = computeAverage([5, 5, 5]);
    expect(avg).toBe(5);
    expect(card).toBe(5);
  });
});

describe("computeMedian", () => {
  test("calcule la médiane (taille impaire)", () => {
    const { median, card } = computeMedian([1, 3, 5]);
    expect(median).toBe(3);
    expect(card).toBe(3);
  });

  test("calcule la médiane (taille paire)", () => {
    const { median, card } = computeMedian([1, 3, 5, 8]);
    expect(median).toBe((3 + 5) / 2);
    expect(card).toBe(nearestCard(median));
  });
});

describe("computeCounts", () => {
  test("compte correctement les occurrences", () => {
    const counts = computeCounts([3, 3, 5, 8, 3, 5]);
    expect(counts).toEqual({ 3: 3, 5: 2, 8: 1 });
  });

  test("gère une liste vide", () => {
    const counts = computeCounts([]);
    expect(counts).toEqual({});
  });
});
