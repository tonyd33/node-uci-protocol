import { parseUCIEngineCmd } from "./Parser.ts";
import {
  guiCmd,
  id,
  UCIEngineCommand,
  UCIGoParameter,
  UCIGUICommand,
  UCIId,
  UCIInfo,
  UCIOption,
  UCIPosition,
  UCIScore,
} from "./Types.ts";
import readline from "node:readline/promises";
import * as E from "fp-ts/lib/Either.js";
import * as TE from "fp-ts/lib/TaskEither.js";
import * as T from "fp-ts/lib/Task.js";
import { absurd, flow, pipe } from "fp-ts/lib/function.js";

/**
 * We only use this type internally. We expose a higher-level interface for
 * clients to work with UCI
 */
type _UCIHandler = (_: UCIEngineCommand) => Promise<UCIGUICommand[]>;

/** A collection of handlers implementing the UCI protocol. */
export interface UCIHandler {
  /**
   * When we receive a "uci" command to initiate the protocol, the engine
   * must identify itself and advertise its options to the client.
   */
  onInit: () => Promise<
    { name: string; author: string; options: UCIOption[] }
  >;
  /**
   * Clients may send this to probe whether the engine is ready to receive
   * another command. This promise should resolve as soon as the engine is
   * ready.
   */
  onReadyProbe: () => Promise<void>;
  /**
   * Usually not used in modern UCI clients.
   */
  onDebug: (on?: boolean) => Promise<void>;
  /**
   * The client has set an option.
   */
  onSetOption: (name: string, value?: string) => Promise<void>;
  /**
   * The client intends to start a new game. This can give the chance for an
   * engine to clean up internal data and prepare for the new game.
   */
  onNewGame: () => Promise<void>;
  /**
   * Client wants to load a position. This should be called before every "go"
   * command. Engines should not begin searching for moves yet, only after
   * receiving the "go" command.
   *
   * The `position` parameter is meant to be paired with the `moves` parameter
   * such that the position a client intends the engine to start its search
   * from is the game state after applying all the `moves` to the `position`.
   */
  onLoadPosition: (
    /** The initial position, before any `moves`. */
    position: UCIPosition,
    /**
     * An array of moves in *long algebraic notation* that should be played
     * after the `position`.
     */
    moves: string[],
  ) => Promise<void>;
  /**
   * Sent when clients want the engine to start processing the position.
   * Clients respecting UCI should only call this after a position has been
   * loaded.
   */
  onGo: (params: UCIGoParameter[]) => Promise<void>;
  /**
   * Client wants to stop searching from a previous "go" command. This may be
   * sent if a "go" command is taking too long to execute and the client wants
   * to cancel the search.
   */
  onStop: () => Promise<void>;
  onPonderHit: () => Promise<void>;
  /**
   * Client wants to terminate the connection and for the engine to exit.
   */
  onQuit: () => Promise<void>;
}

type Tokens = string[];

const always = <A>(a: A) => () => a;

const wrapStrErr = <A, B>(f: (a: A) => Promise<B>) => (a: A) =>
  TE.tryCatch<string, B>(
    () => f(a),
    (err) => {
      if (err instanceof Error) return `Unexpected error: ${err.message}`;
      else return `Unknown error`;
    },
  );

/**
 * Adds a new line to a non-empty string if there wasn't already one.
 * This is useful for writable streams which are flushed only upon receiving
 * a newline, as seems to be the case for Node/Deno's process.stdout/stderr.
 */
const withLine = (s: string) => {
  if (s.length === 0 || s[s.length - 1] === "\n") return s;
  else return s + "\n";
};

const tokenizeId = (id: UCIId): Tokens => {
  switch (id.tag) {
    case "Name":
      return ["name", id.name];
    case "Author":
      return ["author", id.author];
    default:
      return absurd(id);
  }
};

const tokenizeScore = (score: UCIScore): Tokens => {
  switch (score.tag) {
    case "Centipawns":
      return ["cp", `${score.n}`];
    case "Mate":
      return ["mate", `${score.n}`];
    case "Lowerbound":
      return ["lowerbound"];
    case "Upperbound":
      return ["upperbound"];
    default:
      return absurd(score);
  }
};

const tokenizeInfo = (info: UCIInfo): Tokens => {
  switch (info.tag) {
    case "Depth":
      return ["depth", `${info.depth}`];
    case "SelDepth":
      return ["seldepth", `${info.depth}`];
    case "Time":
      return ["time", `${info.time}`];
    case "Nodes":
      return ["nodes", `${info.nodes}`];
    case "Preview":
      return ["pv", ...info.moves];
    case "MultiPreview":
      return ["multipv", `${info.n}`];
    case "Score":
      return ["score", ...info.params.flatMap(tokenizeScore)];
    case "CurrMove":
      return ["currmove", info.move];
    case "CurrMoveNumber":
      return ["currmovenumber", `${info.n}`];
    case "HashFull":
      return ["hashfull", `${info.n}`];
    case "NodesPerSecond":
      return ["nps", `${info.n}`];
    case "TableBaseHits":
      return ["tbhits", `${info.n}`];
    case "ShredderBaseHits":
      return ["sbhits", `${info.n}`];
    case "CPULoad":
      return ["cpuload", `${info.n}`];
    case "String":
      return ["string", `${info.s}`];
    case "Refutation":
      return ["refutation", ...info.moves];
    case "CurrLine":
      return ["currline", `${info.cpunr}`, ...info.moves];
    default:
      return absurd(info);
  }
};

const tokenizeOption = (
  option: UCIOption,
): Tokens => [
  "name",
  option.name,
  "type",
  option.type.toLowerCase(),
  ...(option.default ? ["default", option.default] : []),
  ...(option.min ? ["min", option.min] : []),
  ...(option.max ? ["max", option.max] : []),
  ...(option.var ? ["var", option.var] : []),
];

const tokenizeGUICmd = (guiCmd: UCIGUICommand): Tokens => {
  switch (guiCmd.tag) {
    case "Id":
      return ["id", ...tokenizeId(guiCmd.id)];
    case "UCIOk":
      return ["uciok"];
    case "ReadyOk":
      return ["readyok"];
    case "BestMove":
      return [
        "bestmove",
        guiCmd.move,
        ...(guiCmd.ponder ? [guiCmd.ponder] : []),
      ];
    case "CopyProtection":
      return ["copyprotection", guiCmd.status];
    case "Registration":
      return ["registration", guiCmd.status];
    case "Info":
      return ["info", ...guiCmd.params.flatMap(tokenizeInfo)];
    case "Option":
      return ["option", ...tokenizeOption(guiCmd.option)];
    default:
      return absurd(guiCmd);
  }
};

const serializeTokens = (tokens: Tokens): string => tokens.join(" ");
const serializeGUICmd = flow(tokenizeGUICmd, serializeTokens);

// TODO: Implement copyprotection and registration
const protocolHandler = (
  {
    onInit,
    onReadyProbe,
    onSetOption,
    onDebug,
    onNewGame,
    onLoadPosition,
    onGo,
    onStop,
    onPonderHit,
    onQuit,
  }: UCIHandler,
): _UCIHandler => {
  return async (engineCmd: UCIEngineCommand): Promise<UCIGUICommand[]> => {
    switch (engineCmd.tag) {
      case "UCI":
        return onInit().then((
          { name, author, options },
        ) => [
          guiCmd.id(id.name(name)),
          guiCmd.id(id.author(author)),
          ...options.map(guiCmd.option),
          guiCmd.uciOk,
        ]);
      case "Debug":
        return onDebug(engineCmd.on).then(() => []);
      // Respond to the ping command immediately.
      case "IsReady":
        return onReadyProbe().then(() => [guiCmd.readyOk]);
      case "SetOption":
        return onSetOption(engineCmd.name, engineCmd.value).then(() => []);
      case "Register":
        return [];
      case "UCINewGame":
        return onNewGame().then(() => []);
      case "Position":
        return onLoadPosition(engineCmd.position, engineCmd.moves).then(
          () => [],
        );
      case "Go":
        return onGo(engineCmd.params).then(() => []);
      case "Stop":
        return onStop().then(() => []);
      case "Ponderhit":
        return onPonderHit().then(() => []);
      case "Quit":
        return onQuit().then(() => []);
    }
  };
};

/**
 * Prepares an input and output stream for the UCI protocol to run on
 * and returns functions for communication on these streams.
 */
export const prepare = (
  { input, output, error }: {
    /**
     * UCI is only defined for stdin/stdout of programs, but we allow
     * configuration for, e.g. testing
     * @example process.stdin
     */
    input: NodeJS.ReadableStream;
    /**
     * UCI is only defined for stdin/stdout of programs, but we allow
     * configuration for, e.g. testing
     * @example process.stdout
     */
    output: NodeJS.WritableStream;
    /**
     * A separate, additional stream to write errors or other metadata to, to
     * prevent polluting the main stream.
     * @example process.stderr
     */
    error?: NodeJS.WritableStream;
  },
): {
  /**
   * Start listening for UCI on the prepared streams.
   * Returns a callback that closes the stream.
   */
  listen: (handler: UCIHandler) => { close: () => void };
  /**
   * Send arbitrary information to the client. This may be used for engines
   * to send stats like CPU time, search depth, etc.
   */
  sendInfo: (info: UCIInfo) => Promise<void>;
  /** Send the best move after a "go" command. */
  sendBestMove: (move: string, ponder?: string) => Promise<void>;
} => {
  const writeP = (s: string) =>
    new Promise<void>((resolve) => output.write(withLine(s), () => resolve()));
  const writeErrorP = (s: string) =>
    new Promise<void>((resolve) =>
      error ? error.write(withLine(s), () => resolve()) : resolve
    );

  const sendInfo = (info: UCIInfo) =>
    pipe(guiCmd.info([info]), serializeGUICmd, writeP);
  const sendBestMove = flow(guiCmd.bestMove, serializeGUICmd, writeP);

  return {
    listen: (handler: UCIHandler) => {
      const iface = readline.createInterface({
        input,
        output,
        terminal: false,
      });
      const lowLevelHandler = pipe(protocolHandler(handler), wrapStrErr);
      const informResult = (ex: E.Either<string, string>): T.Task<void> =>
        pipe(
          ex,
          E.map(flow(writeP, always)),
          E.getOrElse(flow(writeErrorP, always)),
        );

      const handleLine = (line: string) => {
        const processLine = pipe(
          line,
          TE.of,
          TE.chain(flow(parseUCIEngineCmd, TE.fromEither)),
          TE.chain(lowLevelHandler),
          TE.map((cmds) => cmds.map(serializeGUICmd).join("\n")),
          T.tap(informResult),
        );
        return processLine();
      };

      iface.on("line", handleLine);
      return {
        close: () => {
          iface.removeAllListeners();
          iface.close();
        },
      };
    },
    sendInfo,
    sendBestMove,
  };
};
