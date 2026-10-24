# screenChess

screenChess watches a shared window or a recording and places that chess position on a local board. Stockfish then says what it thinks of the position.

## Practice only

Use screenChess to study a position with a friend, or to practice against an engine on your own time. Cheating in a real game is not condoned. A rated game, a tournament game, or any game where engine help is against the rules is not a place for this. People can be careless with a tool like this. Use it for your own practice.

## Who did what

**Stockfish** does the chess. It is a free, open-source chess engine by the Stockfish developers, published under the [GNU GPL](https://www.gnu.org/licenses/gpl-3.0.html). The evaluation bar, the move, and the line all come from Stockfish. screenChess did not write the engine. The git repository does not include the Stockfish program. The Windows download does, still as Stockfish’s own program, under that same license.

- https://stockfishchess.org
- https://github.com/official-stockfish/Stockfish

**screenChess**, by [Salutatorian](https://github.com/Salutatorian), does the recording and the placement. It reads a shared window, a video, or a pasted screenshot and puts that position on the board.

Reading the squares uses [fenshot](https://github.com/scoriiu/fenshot).

## Windows download

People on Windows can download [screenChess.exe](https://github.com/Salutatorian/screenChess/releases/latest) and double-click it. Leave the window open. It opens the board in the browser. Close the window to quit.

No Node install. The first launch unpacks the app, which can take a minute. Stockfish is inside that file and remains credited above.

## Run from source

```bash
npm install
npm start
```

Open http://localhost:4173

Download a Windows Stockfish build from https://stockfishchess.org/download/ and save the program as `engine/stockfish.exe`. The engine file is not part of this repo.
