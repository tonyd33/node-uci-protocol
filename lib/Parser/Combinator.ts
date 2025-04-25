import * as E from "fp-ts/lib/Either.js";
import * as P from "./Parser.ts";
import { alt, chain, many, of, Parser } from "./Parser.ts";
import { Do } from "fp-ts-contrib/lib/Do.js";
import { flow, pipe } from "fp-ts/lib/function.js";

/**
 * =============================================================================
 *                             Parser Combinators
 * =============================================================================
 */

export const many1 = <A>(p: Parser<A>): Parser<A[]> => (x) =>
  Do(E.Monad)
    .bind("he", p(x))
    .bindL("te", ({ he: [_, rest] }) => many(p)(rest))
    .return((
      { he: [h, _], te: [t, rest] },
    ) => [[h, ...t], rest]);

export const choice = <A>(...ps: Parser<A>[]): Parser<A> =>
  ps.reduceRight((a, b) => P.Alternative.alt(a, () => b), P.Alternative.zero());

export const sepBy1 = <A, B>(p: Parser<A>, sep: Parser<B>): Parser<A[]> =>
  Do(P.Monad)
    .bind("x", p)
    .bind("xs", many(P.Monad.chain(sep, () => p)))
    .return(({ x, xs }) => [x, ...xs]);

export const sepBy = <A, B>(p: Parser<A>, sep: Parser<B>): Parser<A[]> =>
  P.Alternative.alt(sepBy1(p, sep), () => P.Monad.of([]));

export const option = <A>(a: A, p: Parser<A>): Parser<A> =>
  P.Alternative.alt(p, () => P.Alternative.of(a));

export const optional = <A>(p: Parser<A>): Parser<void> =>
  Do(P.Monad)
    .do(p)
    .return(() => {});

export const flat = (p: Parser<string[]>): Parser<string> =>
  P.Functor.map(p, (x) => x.join(""));

export const between = <L, A, R>(
  pl: Parser<L>,
  p: Parser<A>,
  pr: Parser<R>,
): Parser<A> =>
  Do(P.Monad)
    .do(pl)
    .bind("x", p)
    .do(pr)
    .return(({ x }) => x);

export const manyTill =
  <B>(end: Parser<B>) => <A>(p: Parser<A>): Parser<A[]> => {
    const scan = P.Alternative.alt(
      Do(P.Monad)
        .do(end)
        .return((): A[] => []),
      (): Parser<A[]> =>
        Do(P.Monad)
          .bind("x", p)
          .bindL("xs", () => scan)
          .return(({ x, xs }) => [x, ...xs]),
    );
    return scan;
  };

export const lookahead = <A>(p: Parser<A>): Parser<A> => (s) =>
  pipe(
    p(s),
    E.map(([a, _]) => [a, s]),
  );

export const chainl1 = <A>(
  p: Parser<A>,
  op: Parser<(x: A, y: A) => A>,
): Parser<A> => {
  const rest = (x: A): Parser<A> =>
    pipe(
      Do(P.Monad)
        .bind("f", op)
        .bind("y", p)
        .return(({ f, y }) => f(x, y)),
      chain(rest),
      alt(() => of(x)),
    );
  return pipe(p, chain(rest));
};

export const chainl = <A>(p: Parser<A>, op: Parser<(x: A, y: A) => A>, x: A) =>
  pipe(
    chainl1(p, op),
    alt(() => of(x)),
  );

export const expected = (msg: string) => <A>(p: Parser<A>): Parser<A> =>
  flow(p, E.mapLeft((err) => `Expected ${msg} but: ${err}`));
