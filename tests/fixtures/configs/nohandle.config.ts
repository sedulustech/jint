// fixture: rule handle is not a function
export default {
  input: "src/",
  rules: [{ name: "x", criteria: { true: "y", false: "n" }, target: "files", handle: 0.5 }],
  exclude: [],
};
