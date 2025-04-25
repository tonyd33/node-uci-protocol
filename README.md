# node-uci-protocol

A small library implementing the [UCI protocol](https://github.com/tonyd33/node-uci-protocol/blob/master/engine-interface.txt).
Only supports running as a server currently. For client implementations in node, see [node-uci](https://www.npmjs.com/package/node-uci).

Originally made to implement an adapter for an engine written for the [Gleam Chess Tournament](https://github.com/isaacharrisholt/gleam-chess-tournament).
If you want to wrap a Gleam Chess Tournament-compatible engine with UCI,

```sh
# in one terminal, start your engine on http://localhost:8000
cd /path/to/your/engine
gleam run
# in another terminal, start the UCI adapter
cd /path/to/this/repo/root
./start.sh
```

If using this with an SPRT runner, the `start.sh` script suffices as a command to start the UCI engine.

Yes, this is technically deno, not node. Fight me.
