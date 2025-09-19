import React from 'react';
import Bingo from './bingo';
import Confetti from 'react-confetti';

/*
Room-based Multiplayer Bingo Component
Features:
- Enter player name
- Create or Join room by code
- Persists name & last room in sessionStorage (per tab)
- Connects to WS /ws/{room_id}
- Syncs state via REST GET /state/{room_id} on (re)join
- Broadcasts mark_number, winner, reset within room
*/

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_BASE = import.meta.env.VITE_WS_URL_BASE || 'ws://localhost:8000/ws'; // final URL = `${WS_BASE}/${roomId}`

// --- Deterministic board generation (seeded by roomId + playerName) ---
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return h >>> 0; // unsigned 32-bit
}

function xorshift32(seed) {
  let x = seed >>> 0;
  return function next() {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296; // 0..1
  };
}

function generateDeterministicCard(roomId, playerName) {
  if (!roomId || !playerName) return [];
  const seed = hashString(`${roomId}|${playerName}`);
  const rand = xorshift32(seed);
  const nums = Array.from({ length: 25 }, (_, i) => i + 1);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums.map((v, idx) => ({ value: v, isHeld: false, id: idx }));
}

export default function RoomMultiplayerBingo() {
  const socketRef = React.useRef(null);
  const [playerName, setPlayerName] = React.useState(() => sessionStorage.getItem('playerName') || '');
  const [nameInput, setNameInput] = React.useState(playerName);
  const [roomId, setRoomId] = React.useState(() => sessionStorage.getItem('roomId') || '');
  const [roomInput, setRoomInput] = React.useState(roomId);
  const [creatingRoom, setCreatingRoom] = React.useState(false);
  const [players, setPlayers] = React.useState([]);
  const [card, setCard] = React.useState([]); // will be set deterministically once room & player known
  const [numbersDrawn, setNumbersDrawn] = React.useState(new Set());
  const [winner, setWinner] = React.useState(null);
  const [status, setStatus] = React.useState('idle'); // idle|connecting|connected|error|disconnected
  const [errorMsg, setErrorMsg] = React.useState('');
  const [hasInteracted, setHasInteracted] = React.useState(false);
  // Turn-based state
  const [turnOrder, setTurnOrder] = React.useState([]); // array of player names
  const [currentPlayer, setCurrentPlayer] = React.useState(null);
  const [phase, setPhase] = React.useState('waiting'); // waiting | active | finished
  const [lastInvalid, setLastInvalid] = React.useState(null); // { reason, at }

  const isWinner = winner === playerName;

  // Derived board update from numbers drawn (makes newly drawn numbers highlight)
  React.useEffect(() => {
    if (card.length === 25) {
      setCard(prev => prev.map(cell => numbersDrawn.has(cell.value) ? { ...cell, isHeld: true } : { ...cell, isHeld: false }));
    }
  }, [numbersDrawn]);

  // Initialize deterministic board when ready
  React.useEffect(() => {
    if (roomId && playerName && card.length === 0) {
      const base = generateDeterministicCard(roomId, playerName);
      setCard(base.map(c => numbersDrawn.has(c.value) ? { ...c, isHeld: true } : c));
    }
  }, [roomId, playerName]);

  // Connect WebSocket when playerName and roomId are present
  React.useEffect(() => {
    if (!playerName || !roomId) return;

    let ws; // local reference
    let reconnectTimer;
    let attempts = 0;
    const maxAttempts = 5;

    const connect = () => {
      setStatus('connecting');
      ws = new WebSocket(`${WS_BASE}/${roomId}`);
      socketRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        attempts = 0;
        // Join message
        ws.send(JSON.stringify({ type: 'join', name: playerName }));
        // Pull authoritative state (in case of reconnection)
        fetch(`${API_BASE}/state/${roomId}`)
          .then(r => {
            if (!r.ok) throw new Error('Failed to fetch state');
            return r.json();
          })
          .then(state => {
            setPlayers(state.players || []);
            setNumbersDrawn(new Set(state.numbers_drawn || []));
            setWinner(state.winner || null);
          })
          .catch(err => console.error('State sync error:', err));
      };

      ws.onmessage = evt => {
        const data = JSON.parse(evt.data);
        switch (data.type) {
          case 'state': // initial push for new join (already also fetching REST)
            if (data.players) setPlayers(data.players);
            if (data.numbers_drawn) setNumbersDrawn(new Set(data.numbers_drawn));
            if (data.winner) setWinner(data.winner);
            if (data.turn_order) setTurnOrder(data.turn_order);
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            if (data.phase) setPhase(data.phase);
            break;
          case 'player_joined':
            if (data.players) setPlayers(data.players);
            if (data.turn_order) setTurnOrder(data.turn_order);
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            if (data.phase) setPhase(data.phase);
            break;
          case 'player_left':
            if (data.players) setPlayers(data.players);
            if (data.turn_order) setTurnOrder(data.turn_order);
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            if (data.phase) setPhase(data.phase);
            break;
          case 'mark_number':
            setNumbersDrawn(prev => new Set(prev).add(data.number));
            break;
          case 'winner':
            setWinner(data.winner);
            if (data.phase) setPhase(data.phase);
            break;
          case 'reset':
            setNumbersDrawn(new Set());
            setWinner(null);
            {
              const base = generateDeterministicCard(roomId, playerName);
              setCard(base);
            }
            if (data.turn_order) setTurnOrder(data.turn_order);
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            if (data.phase) setPhase(data.phase);
            break;
          case 'next_turn':
            if (data.turn_order) setTurnOrder(data.turn_order);
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            break;
          case 'invalid_move':
            setLastInvalid({ reason: data.reason, at: Date.now(), current: data.current_player });
            if (data.current_player !== undefined) setCurrentPlayer(data.current_player);
            break;
          case 'heartbeat_ack':
          default:
            break;
        }
      };

      ws.onerror = e => {
        console.error('WebSocket error', e);
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus('disconnected');
        if (attempts < maxAttempts) {
          attempts += 1;
          reconnectTimer = setTimeout(connect, 2000 * attempts);
        }
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      ws && ws.close();
    };
  }, [playerName, roomId]);

  // Persist name and room id
  React.useEffect(() => {
    if (playerName) sessionStorage.setItem('playerName', playerName);
  }, [playerName]);
  React.useEffect(() => {
    if (roomId) sessionStorage.setItem('roomId', roomId);
  }, [roomId]);

  function handleCreateRoom() {
    setCreatingRoom(true);
    fetch(`${API_BASE}/rooms`, { method: 'POST' })
      .then(r => {
        if (!r.ok) throw new Error('Failed to create room');
        return r.json();
      })
      .then(data => {
        setRoomId(data.room_id);
        setRoomInput(data.room_id);
      })
      .catch(err => setErrorMsg(err.message))
      .finally(() => setCreatingRoom(false));
  }

  function handleJoinRoom() {
    if (!roomInput.trim()) return;
    setRoomId(roomInput.trim().toUpperCase());
  }

  function holdCell(id) {
    if (winner || phase === 'finished') return;
    if (currentPlayer && currentPlayer !== playerName) {
      // Not this player's turn; ignore locally (server will also reject if sent)
      return;
    }
    const cell = card.find(c => c.id === id);
    if (!cell || numbersDrawn.has(cell.value)) return;

    // Optimistic UI
    setNumbersDrawn(prev => new Set(prev).add(cell.value));

    if (socketRef.current?.readyState === 1) {
      socketRef.current.send(JSON.stringify({ type: 'mark_number', number: cell.value }));
    }

    // After marking, check local board for win (client-side convenience) - actual winner broadcast authoritative
    const updatedBoard = card.map(c => c.id === id ? { ...c, isHeld: true } : (numbersDrawn.has(c.value) ? { ...c, isHeld: true } : c));
    if (checkTotalBingos(updatedBoard) && !winner) {
      if (socketRef.current?.readyState === 1) {
        socketRef.current.send(JSON.stringify({ type: 'winner' }));
      }
      setWinner(playerName); // immediate feedback
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
      for (let row = 0; row < 5; row++) column.push(board[row * 5 + col]);
      if (column.every(cell => cell.isHeld)) bingoCount++;
    }
    const mainDiagonal = [0, 6, 12, 18, 24].map(i => board[i]);
    if (mainDiagonal.every(cell => cell.isHeld)) bingoCount++;
    const antiDiagonal = [4, 8, 12, 16, 20].map(i => board[i]);
    if (antiDiagonal.every(cell => cell.isHeld)) bingoCount++;
    return bingoCount >= 5;
  }

  function handleReset() {
    if (socketRef.current?.readyState === 1) {
      socketRef.current.send(JSON.stringify({ type: 'reset' }));
    }
    setNumbersDrawn(new Set());
    setWinner(null);
    const base = generateDeterministicCard(roomId, playerName);
    setCard(base);
    setPhase('waiting');
    setCurrentPlayer(turnOrder[0] || null);
  }

  const cardElements = card.map(cell => (
    <Bingo
      key={cell.id}
      value={cell.value}
      isHeld={numbersDrawn.has(cell.value)}
      hold={() => holdCell(cell.id)}
      id={cell.id}
      disabled={!!currentPlayer && currentPlayer !== playerName || phase === 'finished'}
    />
  ));

  if (!playerName) {
    return (
      <main>
        <h1 className="title">Enter Name</h1>
        <input
          className="name-input"
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && nameInput.trim()) setPlayerName(nameInput.trim()); }}
          placeholder="Your name"
        />
        <button disabled={!nameInput.trim()} onClick={() => setPlayerName(nameInput.trim())}>Continue</button>
      </main>
    );
  }

  if (!roomId) {
    return (
      <main>
        <h1 className="title">Room Lobby</h1>
        <p>Player: {playerName}</p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            value={roomInput}
            onChange={e => setRoomInput(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={8}
            style={{ textTransform: 'uppercase' }}
          />
          <button onClick={handleJoinRoom} disabled={!roomInput.trim()}>Join</button>
          <button onClick={handleCreateRoom} disabled={creatingRoom}>{creatingRoom ? 'Creating...' : 'Create Room'}</button>
        </div>
        {errorMsg && <p className="error">{errorMsg}</p>}
        <p style={{ fontSize: '0.85rem', marginTop: '1rem' }}>Room codes are 5 random characters when created.</p>
      </main>
    );
  }

  return (
    <main>
      {isWinner && <Confetti />}
      <h1 className="title">Bingo Room {roomId}</h1>
      <div className="status-bar" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Player: {playerName}</span>
        <span>Conn: {status}</span>
        <span>Phase: {phase}</span>
        <span>Turn: {currentPlayer || '-'}</span>
        <span>Players: {players.join(', ') || '...'}</span>
        {winner && <span className="winner">Winner: {winner}</span>}
      </div>
      {lastInvalid && Date.now() - lastInvalid.at < 4000 && (
        <div style={{ color: 'tomato', fontSize: '0.85rem' }}>⚠ {lastInvalid.reason} (Current: {lastInvalid.current || 'N/A'})</div>
      )}
      <div className='bingo-card'>
        {cardElements}
      </div>
      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button onClick={handleReset} disabled={status !== 'connected'}>{winner ? 'New Game' : 'Reset'}</button>
  <button onClick={() => { sessionStorage.removeItem('roomId'); setRoomId(''); setRoomInput(''); }}>Leave Room</button>
      </div>
    </main>
  );
}
