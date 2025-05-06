import React from "react";
import Bingo from "./bingo";
import Confetti from "react-confetti";

export default function App() {
    const [card, setCard] = React.useState(() => generateAllNewCard());
    const [hasHeld, setHasHeld] = React.useState(false);

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
        setHasHeld(true); // Mark that user has started holding
        setCard(oldCard => oldCard.map(card =>
            card.id === id ?
            {...card, isHeld: !card.isHeld} :
            card
        ));
    }
      
    const cardElements = card.map(card => (
        <Bingo 
            key={card.id}
            value={card.value}
            isHeld={card.isHeld}
            hold={() => hold(card.id)}
            id={card.id}
        />
    ));

    function randomFill() {
        setCard(generateAllNewCard());
        setHasHeld(false); // Reset for new game
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

    const gameWon = checkTotalBingos(card);

    return (
        <main>
            {gameWon && <Confetti />}
            <h1 className="title">Bingo</h1>
            <h2 className="instructions">Click on the numbers to hold them. Get 5 in a row to win!</h2>
            <div aria-live="polite" className="sr-only">
                {gameWon && <p>Congratulations! You won! Press "New Game" to start again.</p>}
            </div>
            <div className='bingo-card'>
                {cardElements}
            </div>
            <button
                onClick={randomFill}
                className="random-fill"
                disabled={hasHeld && !gameWon}
            >
                {gameWon ? "New Game":"Random Fill"}
            </button>
        </main>
    );
}
