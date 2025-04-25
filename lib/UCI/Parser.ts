import { Do } from "fp-ts-contrib/lib/Do.js";
import * as E from "fp-ts/lib/Either.js";
import * as P from "../Parser/index.ts";
import {
  UCIEngineCommand,
  UCIGoParameter,
  UCIPosition,
  UCIRegister,
} from "./Types.ts";
import { flow, pipe } from "fp-ts/lib/function.js";

// BEGIN: General Utility
const always = <A>(a: A) => () => a;

const on: P.Parser<true> = pipe(P.str("on"), P.map(always(true)));
const off: P.Parser<false> = pipe(P.str("false"), P.map(always(false)));
const onOff: P.Parser<boolean> = P.choice(on, off);

const word: P.Parser<string> = pipe(
  P.noneOf(" "),
  P.manyTill(P.lookahead(P.choice(P.whitespace, P.eof))),
  P.flat,
);
const words: P.Parser<string[]> = P.sepBy(word, P.whitespaces);

const natural: P.Parser<number> = pipe(
  P.many1(P.digit),
  P.flat,
  P.map((x) => +x),
  P.expected("natural number"),
);
const int: P.Parser<number> = pipe(
  Do(P.Monad)
    .bind("sign", P.option("+", P.oneOf("-+")))
    .bind("int", natural)
    .return(({ sign, int }) => sign === "+" ? int : -int),
  P.expected("integer"),
);

const floating: P.Parser<number> = pipe(
  Do(P.Monad)
    .bind("left", int)
    .bind("dot", P.char("."))
    .bind("right", natural)
    .return(({ left, dot, right }) => parseFloat(`${left}${dot}${right}`)), // lmfao
  P.expected("floating point number"),
);

const numeric: P.Parser<number> = P.choice(floating, natural);

const skipGarbage = <A>(p: P.Parser<A>): P.Parser<A> =>
  // Don't use `always` here, the laziness of the lambda is what prevents
  // infinite recursion
  P.Alternative.alt(p, () =>
    pipe(
      P.anyChar,
      P.chain(always(skipGarbage(p))),
    ));

// END: General Utility

// BEGIN: Sub command parsing

// TODO: Can be more strict about move grammar
const move = word;
const moves = P.sepBy(move, P.whitespaces);

const uciSetOptionValue: P.Parser<string> = Do(P.Monad)
  .do(P.str("value"))
  .do(P.whitespaces)
  .bind(
    "value",
    pipe(
      P.noneOf("\n"),
      P.manyTill(P.choice(P.newline, P.eof)),
      P.flat,
    ),
  )
  .return(({ value }) => value);

const uciSetOptionId: P.Parser<string> = Do(P.Monad)
  .do(P.str("name"))
  .do(P.whitespaces)
  .bind(
    "id",
    pipe(
      P.noneOf("\n"),
      P.manyTill(
        P.lookahead(
          P.choice(
            pipe(P.whitespaces, P.chain(always(P.str("value")))),
            P.newline,
            P.eof,
          ),
        ),
      ),
      P.flat,
    ),
  )
  .return(({ id }) => id);

const uciPositionFen: P.Parser<UCIPosition> = Do(P.Monad)
  .do(P.str("fen"))
  .do(P.whitespaces)
  .bind(
    "fen",
    pipe(
      P.noneOf("\n"),
      P.manyTill(P.lookahead(P.choice(P.str("moves"), P.newline, P.eof))),
      P.flat,
    ),
  )
  .return(({ fen }) => ({ tag: "FEN", fen }));

const uciPositionStartPos: P.Parser<UCIPosition> = pipe(
  P.str("startpos"),
  P.map(always({ tag: "StartPos" })),
);

const uciPositionMoves: P.Parser<string[]> = Do(P.Monad)
  .do(P.str("moves"))
  .do(P.whitespaces)
  .bind("moves", moves)
  .return(({ moves }) => moves);

const uciRegisterLater: P.Parser<UCIRegister> = pipe(
  P.str("later"),
  P.map(always({ tag: "Later" })),
);

const uciRegisterName: P.Parser<UCIRegister> = Do(P.Monad)
  .do(P.str("name"))
  .do(P.whitespaces)
  .bind(
    "name",
    pipe(P.noneOf("\n"), P.manyTill(P.choice(P.newline, P.eof)), P.flat),
  )
  .return(({ name }) => ({ tag: "Name", name }));

const uciRegisterCode: P.Parser<UCIRegister> = Do(P.Monad)
  .do(P.str("code"))
  .do(P.whitespaces)
  .bind(
    "code",
    pipe(P.noneOf("\n"), P.manyTill(P.choice(P.newline, P.eof)), P.flat),
  )
  .return(({ code }) => ({ tag: "Code", code }));

const uciRegister: P.Parser<UCIRegister> = P.choice(
  uciRegisterLater,
  uciRegisterCode,
  uciRegisterName,
);

const uciGoSearchMovesParameter: P.Parser<UCIGoParameter> = Do(P.Monad)
  .do(P.str("searchmoves"))
  .do(P.whitespaces)
  .bind("moves", moves)
  .return(({ moves }) => ({ tag: "SearchMoves", moves }));

const uciGoPonderParameter: P.Parser<UCIGoParameter> = pipe(
  P.str("ponder"),
  P.map(always({ tag: "Ponder" })),
);

const uciGoWTimeParameter: P.Parser<UCIGoParameter> = Do(P.Monad)
  .do(P.str("wtime"))
  .do(P.whitespaces)
  .bind("time", numeric)
  .return(({ time }) => ({ tag: "WTime", time }));

const uciGoBTimeParameter: P.Parser<UCIGoParameter> = Do(P.Monad)
  .do(P.str("btime"))
  .do(P.whitespaces)
  .bind("time", numeric)
  .return(({ time }) => ({ tag: "BTime", time }));

const uciGoWIncParameter: P.Parser<UCIGoParameter> = Do(P.Monad)
  .do(P.str("winc"))
  .do(P.whitespaces)
  .bind("time", numeric)
  .return(({ time }) => ({ tag: "WInc", time }));

const uciGoBIncParameter: P.Parser<UCIGoParameter> = Do(P.Monad)
  .do(P.str("binc"))
  .do(P.whitespaces)
  .bind("time", numeric)
  .return(({ time }) => ({ tag: "BInc", time }));

const uciGoMovesToGoParameter: P.Parser<UCIGoParameter> = Do(P.Monad)
  .do(P.str("movestogo"))
  .do(P.whitespaces)
  .bind("n", numeric)
  .return(({ n }) => ({ tag: "MovesToGo", n }));

const uciGoDepthParameter: P.Parser<UCIGoParameter> = Do(P.Monad)
  .do(P.str("depth"))
  .do(P.whitespaces)
  .bind("depth", numeric)
  .return(({ depth }) => ({ tag: "Depth", depth }));

const uciGoNodesParameter: P.Parser<UCIGoParameter> = Do(P.Monad)
  .do(P.str("nodes"))
  .do(P.whitespaces)
  .bind("nodes", numeric)
  .return(({ nodes }) => ({ tag: "Nodes", nodes }));

const uciGoMateParameter: P.Parser<UCIGoParameter> = Do(P.Monad)
  .do(P.str("mate"))
  .do(P.whitespaces)
  .bind("n", numeric)
  .return(({ n }) => ({ tag: "Mate", n }));

const uciGoMoveTimeParameter: P.Parser<UCIGoParameter> = Do(P.Monad)
  .do(P.str("movetime"))
  .do(P.whitespaces)
  .bind("time", numeric)
  .return(({ time }) => ({ tag: "MoveTime", time }));

const uciGoInfiniteParameter: P.Parser<UCIGoParameter> = pipe(
  P.str("infinite"),
  P.map(always({ tag: "Infinite" })),
);

const uciGoParameter: P.Parser<UCIGoParameter> = P.choice(
  uciGoSearchMovesParameter,
  uciGoPonderParameter,
  uciGoWTimeParameter,
  uciGoBTimeParameter,
  uciGoWIncParameter,
  uciGoBIncParameter,
  uciGoMovesToGoParameter,
  uciGoDepthParameter,
  uciGoNodesParameter,
  uciGoMateParameter,
  uciGoMoveTimeParameter,
  uciGoInfiniteParameter,
);
// END: Sub-command parsing

// BEGIN: UCIEngineCommand
const uciUciCmd: P.Parser<UCIEngineCommand> = pipe(
  P.str("uci"),
  P.map(always({ tag: "UCI" as const })),
  P.expected("uci"),
);

const uciDebugCmd: P.Parser<UCIEngineCommand> = pipe(
  Do(P.Monad)
    .do(P.str("debug"))
    .do(P.whitespaces)
    .bind("on", P.option(undefined, onOff))
    .return(({ on }) => ({ tag: "Debug" as const, on })),
  P.expected("debug [on|off]"),
);

const uciIsReadyCmd: P.Parser<UCIEngineCommand> = pipe(
  P.str("isready"),
  P.map(always({ tag: "IsReady" as const })),
  P.expected("isready"),
);

const uciSetOptionCmd: P.Parser<UCIEngineCommand> = pipe(
  Do(P.Monad)
    .do(P.str("setoption"))
    .do(P.whitespaces)
    .bind("name", uciSetOptionId)
    .do(P.whitespaces)
    .bind("value", uciSetOptionValue)
    .return(({ name, value }) => ({ tag: "SetOption" as const, name, value })),
  P.expected("setoption name <id> [value <x>]"),
);

const uciRegisterCmd: P.Parser<UCIEngineCommand> = pipe(
  Do(P.Monad)
    .do(P.str("register"))
    .do(P.whitespaces)
    .bind("register", uciRegister)
    .return(({ register }) => ({ tag: "Register" as const, register })),
  P.expected("register [parameter]"),
);

const uciNewGameCmd: P.Parser<UCIEngineCommand> = pipe(
  P.str("ucinewgame"),
  P.map(always({ tag: "UCINewGame" as const })),
  P.expected("ucinewgame"),
);

const uciPositionCmd: P.Parser<UCIEngineCommand> = pipe(
  Do(P.Monad)
    .do(P.str("position"))
    .do(P.whitespaces)
    .bind("position", P.choice(uciPositionFen, uciPositionStartPos))
    .do(P.whitespaces)
    .bind("moves", P.option([], uciPositionMoves))
    .return(({ position, moves }) => ({
      tag: "Position" as const,
      position,
      moves,
    })),
  P.expected(
    "position [fen <fenstring> | startpos ]  moves <move1> .... <movei>",
  ),
);

const uciGoCmd: P.Parser<UCIEngineCommand> = pipe(
  Do(P.Monad)
    .do(P.str("go"))
    .do(P.whitespaces)
    .bind("params", P.sepBy(uciGoParameter, P.whitespaces))
    .return(({ params }) => ({ tag: "Go" as const, params })),
  P.expected("go [parameters]"),
);

const uciStopCmd: P.Parser<UCIEngineCommand> = pipe(
  P.str("stop"),
  P.map(always({ tag: "Stop" as const })),
  P.expected("stop"),
);

const uciPonderhitCmd: P.Parser<UCIEngineCommand> = pipe(
  P.str("ponderhit"),
  P.map(always({ tag: "Ponderhit" as const })),
  P.expected("ponderhit"),
);

const uciQuitCmd: P.Parser<UCIEngineCommand> = pipe(
  P.str("quit"),
  P.map(always({ tag: "Quit" as const })),
  P.expected("quit"),
);

const uciEngineCmd: P.Parser<UCIEngineCommand> = P.choice(
  uciUciCmd,
  uciDebugCmd,
  uciIsReadyCmd,
  uciSetOptionCmd,
  uciRegisterCmd,
  uciNewGameCmd,
  uciPositionCmd,
  uciGoCmd,
  uciStopCmd,
  uciPonderhitCmd,
  uciQuitCmd,
);

const uciEngineCmdEOF = Do(P.Monad)
  .bind("cmd", uciEngineCmd)
  .do(P.whitespaces)
  .do(P.eof)
  .return(({ cmd }) => cmd);
// END: UCIEngineCommand

export const parseUCIEngineCmd: (
  s: string,
) => E.Either<string, UCIEngineCommand> = flow(
  pipe(
    // The skip garbage stuff kind of fucks with error reporting...
    // TODO: Fix error accumulation
    skipGarbage(uciEngineCmdEOF),
    P.expected("proper command eventually"),
  ),
  E.map(([c, _]) => c),
);
