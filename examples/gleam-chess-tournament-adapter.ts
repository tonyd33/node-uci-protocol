// deno-lint-ignore-file require-await
import path from "node:path";
import process from "node:process";
import child_process from "node:child_process";
import {
  info,
  prepare,
  score,
  UCIHandler,
  UCIInfo,
  UCIOption,
  UCIPosition,
} from "../lib/UCI/index.ts";
import { absurd } from "fp-ts/lib/function.js";
import { Transform, Writable } from "node:stream";
import fs from "node:fs";
import { Chess } from "chess.js";
import { UCIGoParameter } from "../lib/UCI/Types.ts";

const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * An "engine" implementing a UCI engine that acts as a light wrapper around
 * the gleam chess tournament bot interface.
 */
class UCIProxyHandler implements UCIHandler {
  /** Name advertised to UCI client on initialization. */
  private name: string;
  /** Author advertised to UCI client on initialization. */
  private author: string;
  private advertiseOptions: UCIOption[];
  /**
   * The URL to send requests to, in the gleam chess tournament format.
   * @example "http://localhost:8000/move"
   */
  private robotUrl: string;
  /**
   * We may be provided the timeout for moves through UCI, but in case we
   * don't, fall back to timing out the robot after this many ms.
   */
  private defaultMoveTimeoutMs: number;

  private fen: string = startFen;
  private moves: string[] = [];

  private initialized: boolean;

  private sendInfo: (info: UCIInfo) => Promise<void>;
  private sendBestMove: (move: string, ponder?: undefined) => Promise<void>;

  private chess: Chess;

  private logDebug: (s: string) => void;

  /**
   * Controls aborting the robot request in case we receive the "stop" command.
   */
  private abortController: AbortController;
  /**
   * If this is defined, we're currently waiting for the response of the
   * robot.
   */
  private robotRequest?: Promise<string>;

  /** fuck */
  private onQuit_: () => Promise<void>;
  /** lol */
  private onStartup: () => Promise<void>;

  constructor(
    {
      name,
      author,
      advertiseOptions,
      robotUrl,
      sendInfo,
      sendBestMove,
      debugLog,
      defaultMoveTimeoutMs = 5000,
      onQuit,
      onStartup,
    }: {
      name: string;
      author: string;
      advertiseOptions: UCIOption[];
      robotUrl: string;
      sendInfo: (info: UCIInfo) => Promise<void>;
      sendBestMove: (move: string, ponder?: undefined) => Promise<void>;
      debugLog?: (s: string) => void;
      defaultMoveTimeoutMs?: number;
      onQuit: () => Promise<void>;
      onStartup: () => Promise<void>;
    },
  ) {
    this.name = name;
    this.author = author;
    this.advertiseOptions = advertiseOptions;
    this.robotUrl = robotUrl;

    this.initialized = false;
    this.defaultMoveTimeoutMs = defaultMoveTimeoutMs;

    this.sendInfo = sendInfo;
    this.sendBestMove = sendBestMove;
    this.chess = new Chess();
    this.logDebug = debugLog ?? (() => {});
    this.abortController = new AbortController();

    this.onQuit_ = onQuit;
    this.onStartup = onStartup;

    this.onInit = this.onInit.bind(this);
    this.onReadyProbe = this.onReadyProbe.bind(this);
    this.onDebug = this.onDebug.bind(this);
    this.onSetOption = this.onSetOption.bind(this);
    this.onNewGame = this.onNewGame.bind(this);
    this.onLoadPosition = this.onLoadPosition.bind(this);
    this.onGo = this.onGo.bind(this);
    this.onStop = this.onStop.bind(this);
    this.onPonderHit = this.onPonderHit.bind(this);
    this.onQuit = this.onQuit.bind(this);
  }

  async onInit() {
    await this.onStartup();
    this.initialized = true;

    return {
      name: this.name,
      author: this.author,
      options: this.advertiseOptions,
    };
  }

  /** Simply wait for the robot request to finish, if there was any. */
  async onReadyProbe() {
    if (!this.robotRequest) return;

    await this.robotRequest.catch(() => {});
  }

  async onDebug() {}

  async onSetOption(name: string, value?: string) {}

  async onNewGame() {
    this.fen = startFen;
    this.moves = [];
  }

  async onLoadPosition(position: UCIPosition, moves: string[]) {
    switch (position.tag) {
      case "FEN": {
        this.fen = position.fen;
        break;
      }
      case "StartPos": {
        this.fen = startFen;
        break;
      }
      default:
        absurd(position);
    }
    this.moves = moves;
  }

  private loadBoard() {
    this.chess.load(this.fen);
    try {
      for (const lan of this.moves) {
        const { from, to, promotion } = this.lanToFromTo(lan);
        this.chess.move({ from, to, promotion });
      }
    } catch (err) {
      if (err instanceof Error) {
        this.logDebug(
          `Error applying moves: ${err.message}. All moves: ${
            JSON.stringify(this.moves)
          }. Available moves: ${this.chess.moves()}`,
        );
      } else {
        this.logDebug("Unknown error");
      }
    }
  }

  private lanToFromTo(lan: string) {
    const from = lan.slice(0, 2);
    const to = lan.slice(2, 4);
    const promotion = lan.slice(4) || undefined;
    return { from, to, promotion };
  }

  private sanToLan(san: string): string {
    this.loadBoard();
    const move = this.chess.move(san);
    this.chess.undo();

    const lan = `${move.from}${move.to}${move.promotion ?? ""}`;
    return lan;
  }

  async onGo(params: UCIGoParameter[]) {
    if (this.robotRequest) {
      this.logDebug("Received a go request while another go request active!");
      this.logDebug("If client was respecting UCI, then we have a severe bug.");
      this.logDebug("I don't know what to do, so I guess I'll die.");
      process.exit(1);
    } else if (!this.initialized) {
      this.logDebug("Received a go request before initialization.");
      this.logDebug("This is non-fatal, but may indicate a bug.");
      this.logDebug("Execution will continue.");
    }

    this.loadBoard();

    this.logDebug("Received go.");
    this.logDebug("Current chess board is:");
    this.logDebug(this.chess.ascii());
    this.logDebug(`FEN: ${this.chess.fen()}`);

    /*
     * Goal:
     * Upon receiving a go command, we request the robot for its move.
     *
     * While we wait on the robot, any isready commands from the client should
     * block until either we receive a command from the robot, or we time out,
     * or the robot request is cancelled with a stop command.
     *
     * If the request takes longer than the timeout, we should cancel the
     * request, in which case we have nothing to send to the client.
     *
     * If we receive a stop command (usually after we've timed out), we should
     * abort any pending requests. Properly aborting pending requests is
     * important so we don't accidentally send stale responses from a slow
     * robot move.
     */

    const turn = this.fen.split(" ")[1] === "w" ? "white" : "black";
    const realRobotRequest = fetch(this.robotUrl, {
      method: "POST",
      body: JSON.stringify({ fen: this.chess.fen(), failed_moves: [], turn }),
      headers: { "Content-Type": "application/json" },
      signal: this.abortController.signal,
    })
      .then((res) => res.text());
    // Create a promise that always times out. We race this robot request
    // against this
    // const timeoutMs = params.find((param) => param.tag === "MoveTime")?.time ??
    //   this.defaultMoveTimeoutMs;
    // const timeoutPromise: Promise<string> = new Promise(
    //   (_, reject) =>
    //     setTimeout(
    //       () => reject(new Error(`Timeout of ${timeoutMs}ms reached`)),
    //       timeoutMs,
    //     ),
    // );
    this.robotRequest = Promise.race([realRobotRequest /* ,timeoutPromise */]);

    try {
      this.logDebug("Asking robot");
      const response = await this.robotRequest;
      this.logDebug(`Robot says: ${response}`);
      const lan = this.sanToLan(response);
      // TODO: Send real score
      await this.sendInfo(info.score([score.centipawns(1)]));
      await this.sendBestMove(lan);
    } catch (err) {
      if (err instanceof Error) {
        this.logDebug(`Caught error while asking robot: ${err.message}`);
      } else {
        this.logDebug(`Caught unknown error while asking robot.`);
      }
    } finally {
      this.robotRequest = undefined;
    }
  }

  async onStop() {
    this.logDebug("Received a stop command, aborting robot...");
    this.abortController.abort();
  }
  async onPonderHit() {}
  async onQuit() {
    this.onQuit_();
    process.exit(0);
  }
}

// bunch of jank below for detailed logs lol

const prefixChunk =
  (prefix: string, timestamped: boolean = true) => (chunk: any) => {
    const now = new Date();
    const timestamp = timestamped
      ? `[${now.getHours().toString().padStart(2, "0")}:${
        now.getMinutes().toString().padStart(2, "0")
      }.${now.getMilliseconds().toString().padStart(3, "0")}] `
      : "";
    const s = chunk
      .toString()
      .split("\n")
      .filter((line: string) => line.length > 0)
      .map((line: string) => `${prefix}${timestamp}${line}`).join("\n");
    if (s.length > 0 && s[s.length - 1] !== "\n") return s + "\n";
    return s;
  };

const prefixTransformer = (prefix: string) =>
  new Transform({
    transform(chunk, _encoding, cb) {
      cb(null, prefixChunk(prefix)(chunk));
    },
  });

const teePrefixedStream = (
  ostream: NodeJS.WritableStream,
  dupstream: NodeJS.WritableStream,
  prefix: string,
) =>
  new Writable({
    write(chunk, encoding, cb) {
      ostream.write(chunk, encoding);
      dupstream.write(prefixChunk(prefix)(chunk));
      cb();
    },
  });

const tapPrefixedStream = (
  ostream: NodeJS.ReadableStream,
  dupstream: NodeJS.WritableStream,
  prefix: string,
) => {
  const xform = prefixTransformer(prefix);
  ostream.pipe(xform).pipe(dupstream);
  return ostream;
};

const prefixStream = (
  ostream: NodeJS.WritableStream,
  prefix: string,
): Writable =>
  new Writable({
    write(chunk, _encoding, callback) {
      ostream.write(prefixChunk(prefix)(chunk), callback);
    },
  });

async function setupRobot() {
  const robot = child_process.spawn("gleam", ["run"], {
    cwd: path.join(
      new URL(".", import.meta.url).pathname,
      "../../../erlang_template",
    ),
    env: process.env,
    detached: true,
  });
  if (!robot.pid) {
    process.stderr.write("Failed to spawn robot\n");
    process.exit(1);
  }
  // Make sure this typechecks as a number for later
  const robotPid = robot.pid;

  const errorIfClosedEarly = () => {
    process.stdout.write("Robot failed to start\n");
    process.exit(1);
  };
  robot.on("close", errorIfClosedEarly);
  await new Promise<void>((resolve) => robot.stdout.on("data", resolve));
  robot.removeListener("close", errorIfClosedEarly);

  const exitGracefully = async () => {
    process.stderr.write("Exiting gracefully...\n");
    const death = new Promise((resolve) => robot.on("close", resolve));
    const timeout = new Promise<void>((resolve) =>
      setTimeout(() => {
        process.stderr.write("Robot didn't die before timeout\n");
        resolve();
      }, 5000)
    );
    // Kill process group. Works only on unix
    process.kill(-robotPid);
    await Promise.race([death, timeout]);
    process.stderr.write("Done.\n");
    process.exit(0);
  };
  process.on("SIGINT", exitGracefully);
  process.on("SIGTERM", exitGracefully);

  return exitGracefully;
}

async function main() {
  const shouldLog = process.argv.includes("--debug");
  const debugLogPath = shouldLog ? "/tmp/uci-adapter-debug.log" : "/dev/null";

  const debugLogStrm = fs.createWriteStream(debugLogPath, { flags: "a" });

  const stdoutTee = teePrefixedStream(process.stdout, debugLogStrm, "[>>>]: ");
  const stderrTee = teePrefixedStream(process.stderr, debugLogStrm, "[>->]: ");
  const stdinTap = tapPrefixedStream(process.stdin, debugLogStrm, "[<<<]: ");
  const debugStrm = prefixStream(debugLogStrm, "[>~>]: ");

  // holy fuck this is cursed.
  //
  // We can't block early, otherwise we'll "miss" handling the "uci" command,
  // and the SPRT runner will think we're unresponsive and kill us.
  // The graceful exit handler can only be retrieved after awaiting the
  // setupRobot promise though and we have to pass this handler to onQuit.
  // To do so, we have to thunk-ify the handler.
  //
  // Really, this is in need of an architecture improvement, but I can't be
  // bothered.
  // - Tony
  const setupRobotPromise = setupRobot();
  const exitGracefully = async () => {
    const f = await setupRobotPromise;
    return f();
  };

  const { listen, sendInfo, sendBestMove } = prepare({
    input: stdinTap,
    output: stdoutTee,
    error: stderrTee,
  });

  const handler = new UCIProxyHandler({
    name: "Gnomes",
    author: "Gnomes",
    advertiseOptions: [],
    robotUrl: "http://localhost:8000/move",
    sendInfo,
    sendBestMove,
    debugLog: (s) => debugStrm.write(s),
    onQuit: exitGracefully,
    onStartup: async () => {
      await setupRobotPromise;
    },
  });

  listen(handler);
}

main();
