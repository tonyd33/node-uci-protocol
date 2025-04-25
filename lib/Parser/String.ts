import * as E from "fp-ts/lib/Either.js";
import { choice, flat } from "./Combinator.ts";
import { Parser, many } from "./Parser.ts";

/**
 * =============================================================================
 *                             String Parsers
 * =============================================================================
 */

export const satisfy =
  (desc: string) =>
  (pred: (_: string) => boolean): Parser<string> =>
  (x: string) => {
    if (x.length === 0) return E.left(`Expected ${desc} but got EOF`);
    else if (pred(x[0])) return E.right([x[0], x.slice(1)]);
    else return E.left(`Expected ${desc}, but got '${x[0]}'`);
  };

export const oneOf = (of: string): Parser<string> =>
  satisfy(`one of "${of}"`)((x) => of.includes(x));

export const noneOf = (of: string): Parser<string> =>
  satisfy(`none of "${of}"`)((x) => !of.includes(x));

export const char = (ch: string): Parser<string> =>
  satisfy(`character '${ch}'`)((x) => x === ch);

export const anyChar = satisfy("anything")(() => true);

export const str = (s: string): Parser<string> => (x: string) => {
  if (x.startsWith(s)) return E.right([s, x.slice(s.length)]);
  else return E.left(`Expected "${s}"`);
};

export const whitespace = oneOf("\n\t\r ");
export const whitespaces = flat(many(whitespace));
export const newline = choice(char("\n"), str("\r\n"));
export const eof: Parser<string> = (s: string) =>
  s.length === 0 ? E.right(["", s]) : E.left("Expected EOF");

export const digit = oneOf("0123456789");
export const letter = oneOf(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
);
export const asciiChar = satisfy("ascii")((str: string) =>
  // deno-lint-ignore no-control-regex
  /^[\x00-\x7F]+$/.test(str)
);
