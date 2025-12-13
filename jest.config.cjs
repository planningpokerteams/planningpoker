// jest.config.cjs
module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/tests/frontend"],
  setupFiles: ["<rootDir>/tests/frontend/jest.setup.js"],
};
