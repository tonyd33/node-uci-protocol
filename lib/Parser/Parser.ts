import * as E from "fp-ts/lib/Either.js";
import { flow, LazyArg, pipe } from "fp-ts/lib/function.js";
import { Alternative1 } from "fp-ts/lib/Alternative.js";
import { Applicative1 } from "fp-ts/lib/Applicative.js";
import { Apply1 } from "fp-ts/lib/Apply.js";
import { Do } from "fp-ts-contrib/lib/Do.js";
import { Functor1 } from "fp-ts/lib/Functor.js";
import { Monad1 } from "fp-ts/lib/Monad.js";
import {
  alt as enablePipeableAlt,
  ap as enablePipeableAp,
  chain as enablePipeableChain,
  map as enablePipeableMap,
} from "fp-ts/lib/pipeable.js";

/**
 * =============================================================================
 *                             String Parser
 * =============================================================================
 */

export type ParseError = string;
export type Parser<T> = (x: string) => E.Either<ParseError, [T, string]>;
export const URI = "Parser";
export type URI = typeof URI;

declare module "fp-ts/HKT" {
  interface URItoKind<A> {
    readonly Parser: Parser<A>;
  }
}

const _ap = <A, B>(fab: Parser<(a: A) => B>, fa: Parser<A>): Parser<B> => (x) =>
  Do(E.Monad)
    .bind("ef", fab(x))
    .bindL("ea", ({ ef: [_, rest1] }) => fa(rest1))
    .return(({ ef: [f, _], ea: [a, rest2] }) => [f(a), rest2]);

const _of = <A>(a: A): Parser<A> => (x) => E.right([a, x]);

const _map = <A, B>(fa: Parser<A>, f: (a: A) => B): Parser<B> =>
  flow(fa, E.map(([v1, v2]) => [f(v1), v2]));

const _chain = <A, B>(fa: Parser<A>, f: (a: A) => Parser<B>): Parser<B> =>
  flow(fa, E.chain(([a, rest]) => f(a)(rest)));

const _alt = <A>(fa: Parser<A>, that: LazyArg<Parser<A>>): Parser<A> => (x) =>
  pipe(fa(x), E.alt(() => that()(x)));

const _zero = <A>(): Parser<A> => (_) => E.left("zero");

export const liftA2 = <A, B, C>(
  f: (a: A) => (b: B) => C,
  pa: Parser<A>,
  pb: Parser<B>,
): Parser<C> => _ap(_map(pa, f), pb);

export const many = <A>(p: Parser<A>): Parser<A[]> => (x) => {
  const as: A[] = [];
  let rest = x;
  let e = p(rest);
  while (!E.isLeft(e) && rest.length > 0) {
    const [a, next] = e.right;
    as.push(a);
    rest = next;
    e = p(rest);
  }
  return E.right([as, rest]);
};

export const execParser = <A>(p: Parser<A>) => (x: string) => p(x);

export const Functor: Functor1<URI> = {
  URI,
  map: _map,
};

export const Monad: Monad1<URI> = {
  URI,
  ap: _ap,
  map: _map,
  of: _of,
  chain: _chain,
};

export const Applicative: Applicative1<URI> = {
  URI,
  ap: _ap,
  map: _map,
  of: _of,
};

export const Alternative: Alternative1<URI> = {
  URI,
  ap: _ap,
  map: _map,
  of: _of,
  alt: _alt,
  zero: _zero,
};

export const Apply: Apply1<URI> = {
  URI,
  ap: _ap,
  map: _map,
};

export const map = enablePipeableMap(Functor);
export const ap = enablePipeableAp(Applicative);
export const chain = enablePipeableChain(Monad);
export const alt = enablePipeableAlt(Alternative);
export const of = _of;
export const zero = _zero
