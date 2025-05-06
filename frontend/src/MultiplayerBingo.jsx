import React from "react";
import Bingo from "./bingo";
import Confetti from "react-confetti";

export default function App() {
    const socket = React.useRef(null);

    const [card, setCard] = React.useState(() => generateAllNewCard());
    const [hasHeld, setHasHeld] = React.useState(false);
    const [playerName, setPlayerName] = React.useState("");
    const [inputName, setInputName] = React.useState("");
    const [winnerName, setWinnerName] = React.useState(null); // <- NEW
    const isWinner = winnerName === playerName;

    React.useEffect(() => {
        if (!playerName) return;

        socket.current = new WebSocket("ws://localhost:8000/ws");

        socket.current.onopen = () => {
            socket.current.send(JSON.stringify({
                type: "join",
                name: playerName
            }));
        };

        socket.current.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === "mark_number") {
                setCard(prev =>
                    prev.map(cell =>
                        cell.value === data.number ? { ...cell, isHeld: true } : cell
                    )
                );
            }

            if (data.type === "winner") {
                setWinnerName(data.winner);
                alert(`${data.winner} has won the game!`);
            }

            if (data.type === "reset") {
                setCard(generateAllNewCard());
                setHasHeld(false);
                setWinnerName(null);
            }
        };

        socket.current.onclose = () => {
            console.log("Disconnected from server");
        };

        return () => socket.current?.close();
    }, [playerName]);

    function generateAllNewCard() {
        let numbers = Array.from({ length: 25 }, (_, i) => i + 1);
        for (let i = numbers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
        }
        return numbers.map((num, index) => ({
            value: num,
            isHeld: false,
            id: index
        }));
    }

    function hold(id) {
        const selected = card.find(cell => cell.id === id);
        if (!selected || selected.isHeld || winnerName) return;

        setHasHeld(true);
        const updatedCard = card.map(cell =>
            cell.id === id ? { ...cell, isHeld: true } : cell
        );
        setCard(updatedCard);

        socket.current.send(JSON.stringify({
            type: "mark_number",
            number: selected.value
        }));

        if (checkTotalBingos(updatedCard)) {
            socket.current.send(JSON.stringify({
                type: "winner"
            }));
            setWinnerName(playerName); // Immediate feedback
        }
    }

    function checkTotalBingos(board) {
        let bingoCount = 0;
        for (let i = 0; i < 5; i++) {
            const row = board.slice(i * 5, i * 5 + 5);
            if (row.every(cell => cell.isHeld)) bingoCount++;
        }
        for (let col = 0; col < 5; col++) {
            const column = [];
            for (let row = 0; row < 5; row++) {
                column.push(board[row * 5 + col]);
            }
            if (column.every(cell => cell.isHeld)) bingoCount++;
        }
        const mainDiagonal = [0, 6, 12, 18, 24].map(i => board[i]);
        if (mainDiagonal.every(cell => cell.isHeld)) bingoCount++;
        const antiDiagonal = [4, 8, 12, 16, 20].map(i => board[i]);
        if (antiDiagonal.every(cell => cell.isHeld)) bingoCount++;
        return bingoCount >= 5;
    }

    function randomFill() {
        setCard(generateAllNewCard());
        setHasHeld(false);
        setWinnerName(null);

        if (socket.current?.readyState === 1) {
            socket.current.send(JSON.stringify({ type: "reset" }));
        }
    }

    const cardElements = card.map(cell => (
        <Bingo
            key={cell.id}
            value={cell.value}
            isHeld={cell.isHeld}
            hold={() => hold(cell.id)}
            id={cell.id}
        />
    ));

    if (!playerName) {
        return (
            <main>
                <h1 className="title">Enter Your Name</h1>
                <div className="name-input-container">
                    <input
                        className="name-input"
                        type="text"
                        placeholder="Your Name"
                        value={inputName}
                        onChange={(e) => setInputName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && inputName.trim()) {
                                setPlayerName(inputName.trim());
                            }
                        }}
                    />
                    <button
                        className="start-button"
                        onClick={() => {
                            if (inputName.trim()) {
                                setPlayerName(inputName.trim());
                            }
                        }}
                    >
                        Start Game
                    </button>
                </div>
            </main>
        );
    }

    return (
        <main>
            {isWinner && <Confetti />}
            <h1 className="title">Bingo</h1>
            <h2 className="instructions">Click on the numbers to hold them. Get 5 in a row to win!</h2>
            <h3 className="player-name">Player: {playerName}</h3>
            {winnerName && <h4 className="winner-text">🏆 {winnerName} has won the game!</h4>}

            <div className='bingo-card'>
                {cardElements}
            </div>

            <button
                onClick={randomFill}
                className="random-fill"
                disabled={hasHeld && !winnerName}
            >
                {winnerName ? "New Game" : "Random Fill"}
            </button>
        </main>
    );
}
