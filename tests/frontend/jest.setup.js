/**
 * @file tests/frontend/jest.setup.js
 * @description
 * Setup global Jest pour l'environnement Node + JSDOM.
 *
 * Pourquoi ?
 * Certains packages (ou le code app) peuvent utiliser TextEncoder/TextDecoder,
 * qui ne sont pas toujours définis dans l'environnement Jest selon la version
 * de Node/JSDOM.
 *
 * Ce fichier garantit que TextEncoder/TextDecoder sont disponibles sur `global`.
 */

const { TextEncoder, TextDecoder } = require("util");

/**
 * Définit global.TextEncoder si absent.
 * @returns {void}
 */
if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}

/**
 * Définit global.TextDecoder si absent.
 * @returns {void}
 */
if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}
