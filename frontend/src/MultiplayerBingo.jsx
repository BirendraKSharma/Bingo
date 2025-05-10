import React from "react";
import Bingo from "./bingo";
import Confetti from "react-confetti";

export default function App() {
    const socket = React.useRef(null);

    const [card, setCard] = React.useState(() => generateAllNewCard());
    const [hasHeld, setHasHeld] = React.useState(false);
    const [playerName, setPlayerName] = React.useState("");
    const [inputName, setInputName] = React.useState("");
    const [winnerName, setWinnerName] = React.useState(null);
    const [connectionStatus, setConnectionStatus] = React.useState("disconnected");
    const [retryCount, setRetryCount] = React.useState(0);
    const maxRetries = 3;
    const isWinner = winnerName === playerName;

    React.useEffect(() => {
        if (!playerName) return;
        
        let reconnectTimeout = null;
        
        const connectWebSocket = () => {
            setConnectionStatus("connecting");
            console.log(`Connection attempt ${retryCount + 1} of ${maxRetries}`);
            
            socket.current = new WebSocket(import.meta.env.VITE_WS_URL);
            
            socket.current.onopen = () => {
                console.log("Connected to server successfully");
                setConnectionStatus("connected");
                setRetryCount(0); // Reset retry count on successful connection
                
                // Send join message
                socket.current.send(JSON.stringify({
                    type: "join",
                    name: playerName
                }));
            };
            
            socket.current.onerror = (error) => {
                console.error("WebSocket error:", error);
                setConnectionStatus("error");
            };
            
            socket.current.onclose = () => {
                console.log("Disconnected from server");
                setConnectionStatus("disconnected");
                
                // Try to reconnect if we haven't reached max retries
                if (retryCount < maxRetries) {
                    setRetryCount(prev => prev + 1);
                    reconnectTimeout = setTimeout(connectWebSocket, 3000); // Wait 3 seconds before retry
                }
            };
            
            socket.current.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log("Received message:", data);

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
        };
        
        connectWebSocket();
        
        return () => {
            clearTimeout(reconnectTimeout);
            if (socket.current) {
                socket.current.close();
            }
        };
    }, [playerName, retryCount]);

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

        // Check if socket is open before sending
        if (socket.current?.readyState === 1) { // WebSocket.OPEN
            try {
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
            } catch (error) {
                console.error("Error sending WebSocket message:", error);
                setConnectionStatus("error");
            }
        } else {
            console.error("WebSocket is not connected");
            setConnectionStatus("disconnected");
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

        if (socket.current?.readyState === 1) { // WebSocket.OPEN
            try {
                socket.current.send(JSON.stringify({ type: "reset" }));
            } catch (error) {
                console.error("Error sending reset message:", error);
                setConnectionStatus("error");
            }
        } else {
            console.log("WebSocket not connected, only resetting local state");
        }
    }

    const connectionStatusUI = () => {
        switch(connectionStatus) {
            case "connecting":
                return <p className="connection-status connecting">Connecting to server...</p>;
            case "connected":
                return <p className="connection-status connected">Connected to server</p>;
            case "disconnected":
                return <p className="connection-status disconnected">Disconnected from server</p>;
            case "error":
                return <p className="connection-status error">Connection error. Please try again later.</p>;
            default:
                return null;
        }
    };

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
            {connectionStatusUI()}
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
