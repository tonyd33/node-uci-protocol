export type UCIRegister =
  | { tag: "Later" }
  | { tag: "Name"; name: string }
  | { tag: "Code"; code: string };

export type UCIPosition =
  | { tag: "FEN"; fen: string }
  | { tag: "StartPos" };

export type UCIScore =
  | { tag: "Centipawns"; n: number }
  | { tag: "Mate"; n: number }
  | { tag: "Lowerbound" }
  | { tag: "Upperbound" };

export type UCIInfo =
  | { tag: "Depth"; depth: number }
  | { tag: "SelDepth"; depth: number }
  | { tag: "Time"; time: number }
  | { tag: "Nodes"; nodes: number }
  | { tag: "Preview"; moves: string[] } // pv
  | { tag: "MultiPreview"; n: number } // multipv
  | { tag: "Score"; params: UCIScore[] }
  | { tag: "CurrMove"; move: string }
  | { tag: "CurrMoveNumber"; n: number }
  | { tag: "HashFull"; n: number }
  | { tag: "NodesPerSecond"; n: number } // nps
  | { tag: "TableBaseHits"; n: number }
  | { tag: "ShredderBaseHits"; n: number }
  | { tag: "CPULoad"; n: number }
  | { tag: "String"; s: string }
  | { tag: "Refutation"; moves: string[] }
  | { tag: "CurrLine"; cpunr: number; moves: string[] };

export type UCIGoParameter =
  | { tag: "SearchMoves"; moves: string[] }
  | { tag: "Ponder" }
  | { tag: "WTime"; time: number }
  | { tag: "BTime"; time: number }
  | { tag: "WInc"; time: number }
  | { tag: "BInc"; time: number }
  | { tag: "MovesToGo"; n: number }
  | { tag: "Depth"; depth: number }
  | { tag: "Nodes"; nodes: number }
  | { tag: "Mate"; n: number }
  | { tag: "MoveTime"; time: number }
  | { tag: "Infinite" };

export type UCIEngineCommand =
  | { tag: "UCI" }
  | { tag: "Debug"; on?: boolean }
  | { tag: "IsReady" }
  | { tag: "SetOption"; name: string; value?: string }
  | { tag: "Register"; register: UCIRegister }
  | { tag: "UCINewGame" }
  | { tag: "Position"; position: UCIPosition; moves: string[] }
  | { tag: "Go"; params: UCIGoParameter[] }
  | { tag: "Stop" }
  | { tag: "Ponderhit" }
  | { tag: "Quit" };

export type UCIId =
  | { tag: "Name"; name: string }
  | { tag: "Author"; author: string };

export type UCIOption = {
  name: string;
  type: "Check" | "Spin" | "Combo" | "Button" | "String";
  default?: string;
  min?: string;
  max?: string;
  var?: string;
};

export type UCIGUICommand =
  | { tag: "Id"; id: UCIId }
  | { tag: "UCIOk" }
  | { tag: "ReadyOk" }
  | { tag: "BestMove"; move: string; ponder?: string }
  | { tag: "CopyProtection"; status: "ok" | "error" }
  | { tag: "Registration"; status: "ok" | "checking" | "error" }
  | { tag: "Info"; params: UCIInfo[] }
  | { tag: "Option"; option: UCIOption };

// Smart constructors
// Avoid polluting the main namespace by "namespacing" smart constructors for
// each type using objects.

export const id = {
  name: (name: string): UCIId => ({ tag: "Name", name }),
  author: (author: string): UCIId => ({ tag: "Author", author }),
};

export const score = {
  centipawns: (n: number): UCIScore => ({ tag: "Centipawns", n }),
  mate: (n: number): UCIScore => ({ tag: "Mate", n }),
  lowerbound: { tag: "Lowerbound" as const },
  upperbound: { tag: "Upperbound" as const },
};

export const info = {
  depth: (depth: number): UCIInfo => ({ tag: "Depth", depth }),
  selDepth: (depth: number): UCIInfo => ({ tag: "SelDepth", depth }),
  time: (time: number): UCIInfo => ({ tag: "Time", time }),
  nodes: (nodes: number): UCIInfo => ({ tag: "Nodes", nodes }),
  preview: (moves: string[]): UCIInfo => ({ tag: "Preview", moves }),
  multiPreview: (n: number): UCIInfo => ({ tag: "MultiPreview", n }),
  score: (params: UCIScore[]): UCIInfo => ({ tag: "Score", params }),
  currMove: (move: string): UCIInfo => ({ tag: "CurrMove", move }),
  currMoveNumber: (n: number): UCIInfo => ({ tag: "CurrMoveNumber", n }),
  hashFull: (n: number): UCIInfo => ({ tag: "HashFull", n }),
  nodesPerSecond: (n: number): UCIInfo => ({ tag: "NodesPerSecond", n }),
  tableBaseHits: (n: number): UCIInfo => ({ tag: "TableBaseHits", n }),
  shredderBaseHits: (n: number): UCIInfo => ({ tag: "ShredderBaseHits", n }),
  cpuLoad: (n: number): UCIInfo => ({ tag: "CPULoad", n }),
  str: (s: string): UCIInfo => ({ tag: "String", s }),
  refutation: (moves: string[]): UCIInfo => ({ tag: "Refutation", moves }),
  currLine: (cpunr: number, moves: string[]): UCIInfo => ({
    tag: "CurrLine",
    cpunr,
    moves,
  }),
};

export const guiCmd = {
  id: (uciId: UCIId): UCIGUICommand => ({ tag: "Id", id: uciId }),
  uciOk: { tag: "UCIOk" as const },
  readyOk: { tag: "ReadyOk" as const },
  bestMove: (move: string, ponder?: string): UCIGUICommand => ({
    tag: "BestMove",
    move,
    ponder,
  }),
  copyProtection: (status: "ok" | "error"): UCIGUICommand => ({
    tag: "CopyProtection",
    status,
  }),
  registration: (status: "ok" | "error" | "checking"): UCIGUICommand => ({
    tag: "Registration",
    status,
  }),
  info: (params: UCIInfo[]): UCIGUICommand => ({ tag: "Info", params }),
  option: (option: UCIOption): UCIGUICommand => ({ tag: "Option", option }),
};
