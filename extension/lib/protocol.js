// Shared message types across side panel <-> content <-> background.
// Kept as globals for classic script contexts; the content script and
// side panel both include this via manifest / <script>.

self.JARVIS = self.JARVIS || {};

self.JARVIS.MSG = Object.freeze({
  // sidepanel -> background
  RUN_TASK: "RUN_TASK",
  STOP_TASK: "STOP_TASK",
  USER_CONFIRM: "USER_CONFIRM",
  USER_CHOOSE: "USER_CHOOSE",

  // background -> content
  SNAPSHOT: "SNAPSHOT",
  EXECUTE: "EXECUTE",
  SCREENSHOT: "SCREENSHOT",

  // background -> sidepanel
  LOG: "LOG",
  STATUS: "STATUS",
  ASK_CONFIRM: "ASK_CONFIRM",
  ASK_CHOOSE: "ASK_CHOOSE",
  DONE: "DONE",
});

// Primitive actions the agent can execute.
self.JARVIS.INTENTS = Object.freeze([
  "OPEN_URL",
  "SEARCH",
  "CLICK",
  "TYPE",
  "PRESS_ENTER",
  "SCROLL",
  "GO_BACK",
  "DOWNLOAD",
  "READ_PAGE",
  "DONE",
]);
